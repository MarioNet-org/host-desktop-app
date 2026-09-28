const { randomBytes } = require('node:crypto');
const { AuthClient } = require('./auth.cjs');
const validToken = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validUser = value => value && typeof value.id === 'string' && typeof value.email === 'string' && typeof value.emailVerified === 'boolean';

class PersistentAuth extends AuthClient {
  state() { return !this.closed && this.session ? { user: { ...this.session.user }, expiresAt: this.session.expiresAt } : null; }
  async post(route, body) {
    return this.fetch(`${this.origin}/api/v1/auth/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
  }
  record() { return { refreshToken: this.session.refreshToken, pending: this.session.pending, user: this.session.user }; }
  schedule(delay = 10 * 60 * 1000) {
    clearTimeout(this.timer);
    if (this.closed) return;
    this.timer = setTimeout(() => void this.refresh().catch(() => this.schedule(30000)), delay);
    this.timer.unref();
  }
  async restore() {
    if (this.restored) return this.state();
    if (this.restoring) return this.restoring;
    this.restoring = (async () => {
      const stored = await this.store.load();
      this.restored = true;
      if (!stored) return null;
      if (!validToken(stored.refreshToken) || (stored.pending && !validToken(stored.pending))) throw new Error('STORAGE_ERROR');
      if (stored.logout) { this.logoutRecord = stored; await this.flushLogout(); return null; }
      if (!validUser(stored.user)) throw new Error('STORAGE_ERROR');
      this.session = { ...stored, accessToken: '', expiresAt: 0 };
      try { await this.refresh(); } catch { this.schedule(30000); }
      return this.state();
    })();
    try { return await this.restoring; } finally { this.restoring = null; }
  }
  async signin(input) {
    if (this.logoutRecord && !await this.flushLogout()) return { ok: false, code: 'NETWORK_ERROR' };
    const result = await super.signin(input);
    // Replace the login-only base class expiry timer before yielding again.
    clearTimeout(this.timer);
    if (!result.ok) return result;
    try { await this.store.save(this.record()); this.schedule(); return result; }
    catch { await this.revoke(this.session?.accessToken); this.session = null; return { ok: false, code: 'STORAGE_ERROR' }; }
  }
  async invalidate() {
    this.session = null; clearTimeout(this.timer);
    await this.store.clear(); this.onExpired();
  }
  async refresh() {
    if (this.rotating) return this.rotating;
    const session = this.session;
    if (!session || this.closed) throw new Error('UNAUTHORIZED');
    this.rotating = (async () => {
      // Persist both secrets BEFORE sending: a lost response/crash retries the same rotation.
      session.pending ||= randomBytes(32).toString('hex');
      await this.store.save(this.record());
      const response = await this.post('refresh', { refreshToken: session.refreshToken, nextRefreshToken: session.pending });
      if (response.status === 401) { await this.invalidate(); throw new Error('UNAUTHORIZED'); }
      if (!response.ok) throw new Error('NETWORK_ERROR');
      const body = await response.json();
      if (!validToken(body.accessToken) || body.refreshToken !== session.pending || body.tokenType !== 'Bearer'
          || !Number.isInteger(body.expiresIn) || body.expiresIn <= 0 || body.expiresIn > 86400 || !validUser(body.user)
          || body.user.id !== session.user.id) throw new Error('INVALID_RESPONSE');
      const updated = { refreshToken: body.refreshToken, user: body.user };
      await this.store.save(updated);
      Object.assign(session, updated, { pending: undefined, accessToken: body.accessToken, expiresAt: Date.now() + body.expiresIn * 1000 });
      this.schedule();
    })();
    try { return await this.rotating; } finally { this.rotating = null; }
  }
  async accessToken() {
    if (this.rotating) await this.rotating;
    if (!this.session || this.closed) throw new Error('UNAUTHORIZED');
    if (this.session.expiresAt <= Date.now() + 30000) await this.refresh();
    return this.session.accessToken;
  }
  async request(route, method = 'GET', body, headers = {}) {
    const session = this.session;
    const send = async () => this.fetch(`${this.origin}/api/v1${route}`, { method,
      headers: { ...headers, Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
    let response = await send();
    if (session !== this.session || this.closed) throw new Error('UNAUTHORIZED');
    if (response.status === 401) { await this.refresh(); response = await send(); }
    const data = response.status === 204 ? {} : await response.json();
    if (session !== this.session || this.closed) throw new Error('UNAUTHORIZED');
    if (response.status === 401) await this.invalidate();
    if (!response.ok) throw new Error(data.error?.code || 'SERVER_ERROR');
    return data;
  }
  async listNodes() {
    try {
      const body = await this.request('/nodes');
      if (!Array.isArray(body.nodes) || body.nodes.length > 1000 || !body.nodes.every(n => n && typeof n.id === 'string' && typeof n.name === 'string' && typeof n.platform === 'string' && typeof n.online === 'boolean' && (n.lastSeenAt === null || typeof n.lastSeenAt === 'string'))) throw new Error('INVALID_RESPONSE');
      return { ok: true, nodes: body.nodes.map(({ id, name, platform, online, lastSeenAt }) => ({ id, name, platform, online, lastSeenAt })) };
    } catch (error) { return { ok: false, code: error.message }; }
  }
  async verification(resend = false) {
    try {
      const data = await this.request(`/auth/email/verification/${resend ? 'request' : 'status'}`, 'POST', {});
      if (!resend) {
        if (typeof data.emailVerified !== 'boolean') throw new Error('INVALID_RESPONSE');
        this.session.user.emailVerified = data.emailVerified;
        // Rotation owns writes while running; avoid overwriting its recovery journal.
        if (this.rotating) await this.rotating;
        if (!this.session) throw new Error('UNAUTHORIZED');
        await this.store.save(this.record());
      }
      return { ok: true, emailVerified: this.session?.user.emailVerified ?? false };
    } catch (error) { return { ok: false, code: error.message }; }
  }
  async flushLogout() {
    try {
      const response = await this.post('signout-refresh', { refreshToken: this.logoutRecord.refreshToken });
      if (!response.ok) throw new Error('NETWORK_ERROR');
      await this.store.clear(); this.logoutRecord = null; return true;
    } catch {
      if (!this.closed) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.flushLogout(), 30000); this.timer.unref();
      }
      return false;
    }
  }
  async signout() {
    if (this.busy) return { ok: false, code: 'BUSY' };
    this.busy = true; clearTimeout(this.timer);
    try {
      if (this.rotating) await this.rotating.catch(() => {});
      clearTimeout(this.timer);
      if (!this.session) return { ok: true };
      const tombstone = { refreshToken: this.session.refreshToken, logout: true };
      await this.store.save(tombstone);
      this.session = null; this.logoutRecord = tombstone;
      await this.flushLogout();
      return { ok: true };
    } catch { return { ok: false, code: 'STORAGE_ERROR' }; }
    finally { this.busy = false; }
  }
  async dispose() {
    this.closed = true; clearTimeout(this.timer);
    // Keep the encrypted session on disk. Closing the app is not signing out.
    if (this.rotating) await this.rotating.catch(() => {});
    clearTimeout(this.timer); this.session = null;
  }
}
module.exports = { PersistentAuth };
