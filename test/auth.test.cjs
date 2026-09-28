const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AuthClient, apiUrl } = require('../electron/auth.cjs');

const input = { email: 'user@example.com', password: 'long-test-password' };
const payload = { accessToken: 'a'.repeat(64), refreshToken: 'b'.repeat(64), tokenType: 'Bearer', expiresIn: 900, user: { id: 'test-user', email: input.email, emailVerified: true } };
const response = (status, body = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('node listing uses the session token only in main and strips unexpected fields', async () => {
  let authorization;
  const node = { id: 'node-a', name: 'PC', platform: 'windows', online: false, lastSeenAt: null };
  const auth = new AuthClient(undefined, { fetchImpl: async (url, options) => {
    if (url.endsWith('/signin')) return response(200, payload);
    if (url.endsWith('/nodes')) { authorization = options.headers.Authorization; return response(200, { nodes: [{ ...node, keyHash: 'must-not-leak' }] }); }
    return response(200);
  } });
  assert.equal((await auth.listNodes()).code, 'UNAUTHORIZED');
  await auth.signin(input);
  assert.deepEqual(await auth.listNodes(), { ok: true, nodes: [node] });
  assert.equal(authorization, `Bearer ${payload.accessToken}`);
  assert.equal((await auth.signout()).ok, true);
  assert.equal(auth.state(), null);
  assert.equal((await auth.listNodes()).code, 'UNAUTHORIZED');
});

test('revoked server session returns to login; late node responses cannot cross logout', async () => {
  let expired = false;
  const revoked = new AuthClient(undefined, { onExpired: () => expired = true, fetchImpl: async url => url.endsWith('/signin') ? response(200, payload) : response(401) });
  await revoked.signin(input);
  assert.equal((await revoked.listNodes()).code, 'UNAUTHORIZED');
  assert.equal(expired, true);
  assert.equal(revoked.state(), null);
  let finish;
  const delayed = new AuthClient(undefined, { fetchImpl: url => url.endsWith('/nodes') ? new Promise(resolve => finish = resolve) : Promise.resolve(response(200, payload)) });
  await delayed.signin(input);
  const pending = delayed.listNodes();
  await delayed.signout();
  finish(response(200, { nodes: [] }));
  assert.equal((await pending).code, 'UNAUTHORIZED');
});

test('signup posts only normalized credentials and does not create a login session', async () => {
  let sent;
  const auth = new AuthClient(undefined, { fetchImpl: async (url, options) => {
    sent = { url, options };
    return response(201, { user: payload.user, password: 'must-not-reach-renderer' });
  } });
  const result = await auth.signup({ email: ' USER@EXAMPLE.COM ', password: ' long-test-password ', confirmation: 'ignored' });
  assert.equal(sent.url.endsWith('/api/v1/auth/signup'), true);
  assert.deepEqual(JSON.parse(sent.options.body), { email: input.email, password: ' long-test-password ' });
  assert.equal(sent.options.redirect, 'error');
  assert.deepEqual(result, { ok: true, user: payload.user });
  assert.equal(auth.state(), null);
});

test('signup rejects invalid input, duplicate email and malformed successful responses', async () => {
  let calls = 0;
  const auth = new AuthClient(undefined, { fetchImpl: async () => { calls++; return response(409); } });
  assert.equal((await auth.signup({ ...input, password: 'short' })).code, 'INVALID_INPUT');
  assert.equal(calls, 0);
  assert.equal((await auth.signup(input)).code, 'EMAIL_EXISTS');
  for (const [status, body, code] of [[429, {}, 'RATE_LIMITED'], [500, {}, 'SERVER_ERROR'], [201, {}, 'INVALID_RESPONSE'], [200, { user: payload.user }, 'INVALID_RESPONSE']]) {
    const client = new AuthClient(undefined, { fetchImpl: async () => response(status, body) });
    assert.equal((await client.signup(input)).code, code);
  }
});

test('signup prevents simultaneous requests and allows an explicit retry after timeout', async () => {
  let finish;
  const auth = new AuthClient(undefined, { fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  const pending = auth.signup(input);
  assert.equal((await auth.signup(input)).code, 'BUSY');
  assert.equal((await auth.signin(input)).code, 'BUSY');
  finish(response(201, { user: payload.user }));
  assert.equal((await pending).ok, true);
  let attempts = 0;
  const timeout = new AuthClient(undefined, { fetchImpl: async () => {
    attempts++;
    if (attempts === 1) throw new DOMException('timeout', 'TimeoutError');
    return response(201, { user: payload.user });
  } });
  assert.equal((await timeout.signup(input)).code, 'TIMEOUT');
  assert.equal(attempts, 1);
  assert.equal((await timeout.signup(input)).ok, true);
});

test('rejects unsafe API origins before sending credentials', () => {
  assert.equal(apiUrl('http://127.0.0.1:4000'), 'http://127.0.0.1:4000');
  assert.equal(apiUrl('https://api.example.com/'), 'https://api.example.com');
  for (const value of ['http://example.com', 'file:///test', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com/?token=secret']) assert.throws(() => apiUrl(value));
});

test('validates credentials in main process before network access', async () => {
  let calls = 0;
  const auth = new AuthClient(undefined, { fetchImpl: async () => { calls++; return response(200, payload); } });
  for (const value of [null, {}, { email: 'bad', password: input.password }, { ...input, password: 'short' }, { ...input, password: 'x'.repeat(129) }]) assert.equal((await auth.signin(value)).code, 'INVALID_INPUT');
  assert.equal(calls, 0);
});

test('normalizes email, never trims password, and returns no credentials to renderer', async () => {
  const requests = [];
  const auth = new AuthClient(undefined, { fetchImpl: async (url, options) => { requests.push({ url, options }); return response(200, payload); } });
  const result = await auth.signin({ email: ' USER@EXAMPLE.COM ', password: ' long-test-password ' });
  assert.deepEqual(JSON.parse(requests[0].options.body), { email: input.email, password: ' long-test-password ' });
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result).sort(), ['expiresAt', 'ok', 'user']);
  assert.equal(JSON.stringify(auth.state()).includes(payload.accessToken), false);
  await auth.dispose();
  assert.equal(requests[1].url.endsWith('/auth/signout'), true);
  assert.equal(auth.state(), null);
});

test('handles authentication, rate limit, invalid JSON, server and network errors', async () => {
  for (const [status, code] of [[401, 'INVALID_CREDENTIALS'], [429, 'RATE_LIMITED'], [500, 'SERVER_ERROR'], [400, 'INVALID_INPUT']]) {
    const auth = new AuthClient(undefined, { fetchImpl: async () => response(status, { error: { message: 'Do not expose raw server details' } }) });
    assert.deepEqual(await auth.signin(input), { ok: false, code });
    assert.equal(auth.state(), null);
  }
  const invalid = new AuthClient(undefined, { fetchImpl: async () => new Response('not-json') });
  assert.equal((await invalid.signin(input)).code, 'INVALID_RESPONSE');
  const malformed = new AuthClient(undefined, { fetchImpl: async () => response(200, { ...payload, expiresIn: -1 }) });
  assert.equal((await malformed.signin(input)).code, 'INVALID_RESPONSE');
  for (const [name, code] of [['TypeError', 'NETWORK_ERROR'], ['TimeoutError', 'TIMEOUT']]) {
    const auth = new AuthClient(undefined, { fetchImpl: async () => { const error = new Error(); error.name = name; throw error; } });
    assert.equal((await auth.signin(input)).code, code);
  }
});

test('blocks concurrent sign-in and revokes a late response after app shutdown', async () => {
  let finish;
  let revoked = false;
  const auth = new AuthClient(undefined, { fetchImpl: (url) => {
    if (url.endsWith('/signout')) { revoked = true; return Promise.resolve(response(200)); }
    return new Promise(resolve => { finish = resolve; });
  } });
  const pending = auth.signin(input);
  assert.equal((await auth.signin(input)).code, 'BUSY');
  await auth.dispose();
  finish(response(200, payload));
  assert.equal((await pending).code, 'CLOSED');
  assert.equal(auth.state(), null);
  assert.equal(revoked, true);
});

test('session expires without retaining tokens or stale login state', async () => {
  let expired = false;
  const auth = new AuthClient(undefined, { fetchImpl: async () => response(200, { ...payload, expiresIn: 1 }), onExpired: () => { expired = true; } });
  await auth.signin(input);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(expired, true);
  assert.equal(auth.state(), null);
  assert.equal(auth.session, null);
  await auth.dispose();
});
