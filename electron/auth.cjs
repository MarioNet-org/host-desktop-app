const { readFileSync } = require("node:fs");
const { parseEnv } = require("node:util");

function apiUrl(value = "http://127.0.0.1:4000") {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "MARIONET_SERVER_URL must be an HTTPS origin (HTTP is allowed only on loopback).",
    );
  }
  return url.origin;
}

function loadApiUrl(path) {
  let env = {};
  try {
    env = parseEnv(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return apiUrl(process.env.MARIONET_SERVER_URL || env.MARIONET_SERVER_URL);
}

class AuthClient {
  constructor(
    origin,
    { fetchImpl = fetch, timeoutMs = 10000, onExpired = () => {} } = {},
  ) {
    this.origin = apiUrl(origin);
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.onExpired = onExpired;
    this.session = null;
    this.busy = false;
    this.closed = false;
  }

  state() {
    if (!this.session || this.session.expiresAt <= Date.now()) return null;
    return {
      user: { ...this.session.user },
      expiresAt: this.session.expiresAt,
    };
  }

  async signup(input) {
    if (this.closed) return { ok: false, code: "CLOSED" };
    if (this.busy) return { ok: false, code: "BUSY" };
    if (this.state()) return { ok: false, code: "ALREADY_SIGNED_IN" };
    if (
      !input ||
      typeof input.email !== "string" ||
      typeof input.password !== "string"
    )
      return { ok: false, code: "INVALID_INPUT" };
    const email = input.email.trim().toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      input.password.length < 12 ||
      input.password.length > 128
    )
      return { ok: false, code: "INVALID_INPUT" };
    this.busy = true;
    try {
      const response = await this.fetch(`${this.origin}/api/v1/auth/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email, password: input.password }),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
      });
      if (!response.ok)
        return {
          ok: false,
          code:
            response.status === 409
              ? "EMAIL_EXISTS"
              : response.status === 429
                ? "RATE_LIMITED"
                : response.status === 400
                  ? "INVALID_INPUT"
                  : "SERVER_ERROR",
        };
      let body;
      try {
        body = await response.json();
      } catch {
        return { ok: false, code: "INVALID_RESPONSE" };
      }
      if (
        response.status !== 201 ||
        !body?.user ||
        typeof body.user.id !== "string" ||
        typeof body.user.email !== "string" ||
        typeof body.user.emailVerified !== "boolean"
      )
        return { ok: false, code: "INVALID_RESPONSE" };
      if (this.closed) return { ok: false, code: "CLOSED" };
      return {
        ok: true,
        ...(body.verificationEmailSent === false ? { verificationEmailSent: false } : {}),
        user: {
          id: body.user.id,
          email: body.user.email,
          emailVerified: body.user.emailVerified,
        },
      };
    } catch (error) {
      return {
        ok: false,
        code:
          error.name === "TimeoutError" || error.name === "AbortError"
            ? "TIMEOUT"
            : "NETWORK_ERROR",
      };
    } finally {
      this.busy = false;
    }
  }

  async signin(input) {
    if (this.closed) return { ok: false, code: "CLOSED" };
    if (this.busy) return { ok: false, code: "BUSY" };
    if (this.state()) return { ok: true, ...this.state() };
    if (
      !input ||
      typeof input !== "object" ||
      typeof input.email !== "string" ||
      typeof input.password !== "string"
    )
      return { ok: false, code: "INVALID_INPUT" };
    const email = input.email.trim().toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      input.password.length < 12 ||
      input.password.length > 128
    )
      return { ok: false, code: "INVALID_INPUT" };
    this.busy = true;
    try {
      const response = await this.fetch(`${this.origin}/api/v1/auth/signin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ email, password: input.password }),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
      });
      if (!response.ok)
        return {
          ok: false,
          code:
            response.status === 401
              ? "INVALID_CREDENTIALS"
              : response.status === 429
                ? "RATE_LIMITED"
                : response.status === 400
                  ? "INVALID_INPUT"
                  : "SERVER_ERROR",
        };
      let body;
      try {
        body = await response.json();
      } catch {
        return { ok: false, code: "INVALID_RESPONSE" };
      }
      if (
        !body ||
        typeof body.accessToken !== "string" ||
        !/^[a-f0-9]{64}$/.test(body.accessToken) ||
        typeof body.refreshToken !== "string" ||
        !/^[a-f0-9]{64}$/.test(body.refreshToken) ||
        body.tokenType !== "Bearer" ||
        !Number.isInteger(body.expiresIn) ||
        body.expiresIn <= 0 ||
        body.expiresIn > 86400 ||
        !body.user ||
        typeof body.user.id !== "string" ||
        typeof body.user.email !== "string" ||
        typeof body.user.emailVerified !== "boolean"
      ) {
        return { ok: false, code: "INVALID_RESPONSE" };
      }
      if (this.closed) {
        await this.revoke(body.accessToken);
        return { ok: false, code: "CLOSED" };
      }
      this.session = {
        accessToken: body.accessToken, refreshToken: body.refreshToken,
        user: {
          id: body.user.id,
          email: body.user.email,
          emailVerified: body.user.emailVerified,
        },
        expiresAt: Date.now() + body.expiresIn * 1000,
      };
      // Login-only scope: no persisted tokens or automatic refresh. Restart requires login.
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.session = null;
        this.onExpired();
      }, body.expiresIn * 1000);
      this.timer.unref();
      return { ok: true, ...this.state() };
    } catch (error) {
      return {
        ok: false,
        code:
          error.name === "TimeoutError" || error.name === "AbortError"
            ? "TIMEOUT"
            : "NETWORK_ERROR",
      };
    } finally {
      this.busy = false;
    }
  }

  async revoke(token) {
    try {
      await this.fetch(`${this.origin}/api/v1/auth/signout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2000),
        redirect: "error",
      });
    } catch {
      /* Best effort at shutdown. No token is persisted locally. */
    }
  }

  async listNodes() {
    const current = this.session;
    if (!this.state()) return { ok: false, code: "UNAUTHORIZED" };
    try {
      const response = await this.fetch(`${this.origin}/api/v1/nodes`, {
        headers: {
          Authorization: `Bearer ${current.accessToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
      });
      if (this.session !== current) return { ok: false, code: "UNAUTHORIZED" };
      if (response.status === 401) {
        clearTimeout(this.timer);
        this.session = null;
        this.onExpired();
        return { ok: false, code: "UNAUTHORIZED" };
      }
      if (!response.ok)
        return {
          ok: false,
          code: response.status === 429 ? "RATE_LIMITED" : "SERVER_ERROR",
        };
      const body = await response.json();
      if (this.session !== current) return { ok: false, code: "UNAUTHORIZED" };
      if (
        !Array.isArray(body?.nodes) ||
        body.nodes.length > 1000 ||
        !body.nodes.every(
          (node) =>
            node &&
            typeof node.id === "string" &&
            typeof node.name === "string" &&
            typeof node.platform === "string" &&
            typeof node.online === "boolean" &&
            (node.lastSeenAt === null || typeof node.lastSeenAt === "string"),
        )
      )
        return { ok: false, code: "INVALID_RESPONSE" };
      return {
        ok: true,
        nodes: body.nodes.map(({ id, name, platform, online, lastSeenAt }) => ({
          id,
          name,
          platform,
          online,
          lastSeenAt,
        })),
      };
    } catch {
      return { ok: false, code: "NETWORK_ERROR" };
    }
  }

  async signout() {
    if (this.busy) return { ok: false, code: "BUSY" };
    this.busy = true;
    const token = this.session?.accessToken;
    clearTimeout(this.timer);
    this.session = null;
    try {
      if (token) await this.revoke(token);
      return { ok: true };
    } finally {
      this.busy = false;
    }
  }

  async dispose() {
    this.closed = true;
    clearTimeout(this.timer);
    const token = this.session?.accessToken;
    this.session = null;
    if (token) await this.revoke(token);
  }
}
module.exports = { AuthClient, apiUrl, loadApiUrl };


