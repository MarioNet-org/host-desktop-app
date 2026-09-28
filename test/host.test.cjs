const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { HostService } = require('../electron/host.cjs');

test('registration persists identity per account, rename uses authenticated endpoint and renderer never receives key', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'marionet-host-test-'));
  const calls = [];
  const auth = { origin: 'http://127.0.0.1:4000', session: { accessToken: 'secret', user: { id: 'a' } }, state() { return this.session; }, async fetch(url, options) {
    calls.push({ url, options });
    return { ok: true, status: 200, async json() { return { node: { id: '11111111-1111-4111-8111-111111111111', name: options.method === 'PATCH' ? 'Renamed' : 'PC' }, nodeKey: 'a'.repeat(64) }; } };
  } };
  auth.request = async (route, method, body, headers) => (await auth.fetch(auth.origin + '/api/v1' + route, { method, body: JSON.stringify(body), headers: { ...headers, Authorization: 'Bearer secret' } })).json();
  // Test-only codec. Production uses Electron safeStorage.
  const storage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString() };
  try {
    const host = new HostService(auth, directory, storage);
    const registered = await host.run('register');
    assert.equal(registered.ok, true); assert.equal(registered.host.name, 'PC');
    assert.equal(JSON.stringify(registered).includes('a'.repeat(64)), false);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
    assert.equal((await host.run('rename', '  Renamed  ')).host.name, 'Renamed');
    assert.equal((await host.run('rename', ' ')).code, 'INVALID_NAME');
    assert.equal((await host.run('allow', 'true')).code, 'INVALID_INPUT');
    const restored = new HostService(auth, directory, storage);
    assert.equal((await restored.run('state')).host.nodeId, registered.host.nodeId);
    auth.session = { accessToken: 'another', user: { id: 'b' } };
    assert.equal((await restored.run('state')).host.nodeId, null);
    assert.ok(await readFile(host.file));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('registration refuses insecure storage and unauthenticated operations', async () => {
  const auth = { origin: 'http://127.0.0.1:4000', state: () => null };
  const host = new HostService(auth, tmpdir(), {});
  assert.equal((await host.run('register')).code, 'UNAUTHORIZED');
  host.userId = 'a'; auth.state = () => ({ user: { id: 'a' } });
  host.storage = { isEncryptionAvailable: () => false };
  assert.equal((await host.run('register')).code, 'STORAGE_UNAVAILABLE');
});

