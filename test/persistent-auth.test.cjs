const test = require('node:test');
const assert = require('node:assert/strict');
const { PersistentAuth } = require('../electron/persistent-auth.cjs');
const user = { id: 'user', email: 'test@example.com', emailVerified: false };
const credentials = { email: user.email, password: 'test-password-long' };
const payload = { accessToken: 'a'.repeat(64), refreshToken: 'b'.repeat(64), tokenType: 'Bearer', expiresIn: 900, user };
const json = (status, data = {}) => ({ ok: status < 400, status, json: async () => data });
function memory() { let saved; return { async load() { return structuredClone(saved); }, async save(v) { saved = structuredClone(v); }, async clear() { saved = null; } }; }
function client(store, fetchImpl) { const auth = new PersistentAuth(undefined, { fetchImpl }); auth.store = store; return auth; }

test('encrypted-store contract retains refresh only across app close and restores automatically', async () => {
  const store = memory();
  const auth = client(store, async () => json(200, payload));
  assert.equal((await auth.signin(credentials)).ok, true);
  assert.equal(JSON.stringify(await store.load()).includes('accessToken'), false);
  await auth.dispose(); assert.ok((await store.load()).refreshToken);
  const restored = client(store, async (_url, options) => {
    const body = JSON.parse(options.body);
    return json(200, { ...payload, refreshToken: body.nextRefreshToken });
  });
  assert.equal((await restored.restore()).user.id, 'user');
  assert.equal(JSON.stringify(restored.state()).includes('refreshToken'), false);
  await restored.dispose();
});

test('lost refresh response survives restart and retries identical secrets; concurrent refresh is single-flight', async () => {
  const store = memory(); let requests = [];
  const first = client(store, async (url, options) => {
    if (url.endsWith('/signin')) return json(200, payload);
    requests.push(JSON.parse(options.body)); throw new Error('network lost after commit');
  });
  await first.signin(credentials);
  await assert.rejects(first.refresh());
  const journal = await store.load(); assert.ok(journal.pending);
  await first.dispose();
  const next = client(store, async (_url, options) => {
    const request = JSON.parse(options.body); requests.push(request);
    return json(200, { ...payload, refreshToken: request.nextRefreshToken });
  });
  await next.restore(); assert.deepEqual(requests[0], requests[1]);
  requests = [];
  await Promise.all([next.refresh(), next.refresh(), next.refresh()]);
  assert.equal(requests.length, 1); assert.equal((await store.load()).pending, undefined);
  await next.dispose();
});

test('offline logout leaves a revocation journal, never auto-signs in, and clears on retry', async () => {
  const store = memory();
  const auth = client(store, async url => { if (url.endsWith('/signin')) return json(200, payload); throw new Error('offline'); });
  await auth.signin(credentials); assert.equal((await auth.signout()).ok, true);
  assert.equal(auth.state(), null); assert.equal((await store.load()).logout, true);
  await auth.dispose();
  const next = client(store, async url => { assert.ok(url.endsWith('/signout-refresh')); return json(204); });
  assert.equal(await next.restore(), null); assert.equal(await store.load(), null); await next.dispose();
});

test('network failure retains login but revoked refresh clears local session', async () => {
  const store = memory(); let revoked = false;
  const auth = client(store, async url => url.endsWith('/signin') ? json(200, payload) : revoked ? json(401) : Promise.reject(new Error('offline')));
  await auth.signin(credentials); await assert.rejects(auth.refresh()); assert.ok(auth.state());
  revoked = true; await assert.rejects(auth.refresh()); assert.equal(auth.state(), null); assert.equal(await store.load(), null);
  await auth.dispose();
});
