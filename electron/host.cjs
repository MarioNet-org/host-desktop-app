const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

class HostService {
  constructor(auth, directory, storage) {
    this.auth = auth; this.directory = directory; this.storage = storage;
    this.status = 'offline'; this.allowed = false; this.busy = false;
  }
  stop() {
    this.allowed = false; this.status = 'offline';
    clearTimeout(this.retry); clearTimeout(this.deadline);
    const socket = this.socket; this.socket = null; socket?.close();
  }
  async request(route, method = 'GET', body) {
    return this.auth.request(route, method, body, this.record ? { 'X-Node-Key': this.record.key } : {});
  }
  async load() {
    const user = this.auth.state()?.user;
    if (!user) throw new Error('UNAUTHORIZED');
    if (this.userId === user.id) return;
    this.stop(); this.record = null; this.userId = user.id;
    this.file = path.join(this.directory, createHash('sha256').update(`${this.auth.origin}:${user.id}`).digest('hex') + '.bin');
    try {
      this.record = JSON.parse(this.storage.decryptString(await fs.readFile(this.file)));
      if (!/^[a-f0-9-]{36}$/.test(this.record.id) || !/^[a-f0-9]{64}$/.test(this.record.key)) throw new Error('STORAGE_ERROR');
    } catch (error) {
      if (error.code !== 'ENOENT') { this.userId = null; this.record = null; throw new Error('STORAGE_ERROR'); }
    }
  }
  async save() {
    await fs.mkdir(this.directory, { recursive: true });
    await fs.writeFile(this.file + '.tmp', this.storage.encryptString(JSON.stringify(this.record)));
    await fs.rename(this.file + '.tmp', this.file);
  }
  snapshot() {
    return { name: this.record?.name || os.hostname(), nodeId: this.record?.id || null, allowed: this.allowed, status: this.status,
      platform: os.platform(), addresses: [...new Set(Object.values(os.networkInterfaces()).flat().filter(n => n && !n.internal && n.family === 'IPv4').map(n => n.address))] };
  }
  async run(operation, input) {
    if (this.busy) return { ok: false, code: 'BUSY' };
    this.busy = true;
    try {
      await this.load();
      if (operation === 'register' && !this.record) {
        if (!this.storage.isEncryptionAvailable() || this.storage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('STORAGE_UNAVAILABLE');
        const platform = { win32: 'windows', darwin: 'macos', linux: 'linux' }[os.platform()];
        if (!platform) throw new Error('UNSUPPORTED_PLATFORM');
        const result = await this.request('/nodes', 'POST', { name: os.hostname().slice(0, 80), platform });
        if (!result.node?.id || !/^[a-f0-9]{64}$/.test(result.nodeKey)) throw new Error('INVALID_RESPONSE');
        this.record = { id: result.node.id, name: result.node.name, key: result.nodeKey };
        try { await this.save(); }
        catch { try { await this.request(`/nodes/${this.record.id}`, 'DELETE'); } catch {} this.record = null; throw new Error('STORAGE_ERROR'); }
      } else if (operation === 'rename') {
        if (!this.record) throw new Error('NOT_REGISTERED');
        if (typeof input !== 'string' || !input.trim() || input.trim().length > 80) throw new Error('INVALID_NAME');
        const result = await this.request(`/nodes/${this.record.id}`, 'PATCH', { name: input.trim() });
        this.record.name = result.node.name; await this.save();
      } else if (operation === 'allow') {
        if (typeof input !== 'boolean') throw new Error('INVALID_INPUT');
        if (!this.record) throw new Error('NOT_REGISTERED');
        this.stop(); this.allowed = input;
        if (input) this.connect();
      }
      return { ok: true, host: this.snapshot() };
    } catch (error) { return { ok: false, code: error.message }; }
    finally { this.busy = false; }
  }
  async connect() {
    if (!this.allowed || !this.auth.state()) return this.stop();
    this.status = 'connecting';
    let accessToken;
    try { accessToken = await this.auth.accessToken(); } catch { if (this.allowed) { this.status = 'reconnecting'; this.retry = setTimeout(() => this.connect(), 5000); } return; }
    if (!this.allowed || !this.auth.state()) return;
    const socket = this.socket = new WebSocket(this.auth.origin.replace(/^http/, 'ws') + '/api/v1/ws');
    this.deadline = setTimeout(() => { if (this.socket === socket) socket.close(); }, 10000);
    socket.onopen = () => {
      if (this.socket !== socket || !this.auth.state()) return socket.close();
      socket.send(JSON.stringify({ type: 'authenticate', accessToken, nodeId: this.record.id, nodeKey: this.record.key }));
    };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ready') { clearTimeout(this.deadline); this.status = 'online'; }
        if (data.type === 'error') { this.stop(); this.status = 'error'; }
        // Remote streaming/input is not implemented: never silently approve control.
        if (data.type === 'connection.updated' && data.connection?.status === 'PENDING' && /^[a-f0-9-]{36}$/.test(data.connection.id)) {
          void this.request(`/connections/${data.connection.id}/reject`, 'POST').catch(() => {});
        }
      } catch { socket.close(); }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      clearTimeout(this.deadline); this.socket = null; this.status = 'reconnecting';
      if (this.allowed) this.retry = setTimeout(() => this.connect(), 5000);
    };
  }
}
module.exports = { HostService };

