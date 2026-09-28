/// <reference types="vite/client" />
type User = { id: string; email: string; emailVerified: boolean };
type LoginSession = { user: User; expiresAt: number };
type LoginResult = ({ ok: true } & LoginSession) | { ok: false; code: string };
type SignupResult = { ok: true; user: User; verificationEmailSent?: boolean } | { ok: false; code: string };
interface Window {
  marioNet?: {
    verification(resend?: boolean): Promise<{ ok: boolean; code?: string; emailVerified?: boolean }>;
    hostState(): Promise<HostResult>;
    registerHost(): Promise<HostResult>;
    renameHost(name: string): Promise<HostResult>;
    allowHost(allow: boolean): Promise<HostResult>;
    signin(input: { email: string; password: string }): Promise<LoginResult>;
    signup(input: { email: string; password: string }): Promise<SignupResult>;
    getSession(): Promise<LoginSession | null>;
    signout(): Promise<{ ok: boolean; code?: string }>;
    onExpired(callback: () => void): () => void;
    minimize(): void;
    maximize(): void;
    close(): void;
  };
}
type HostState = { name: string; nodeId: string | null; allowed: boolean; status: string; platform: string; addresses: string[] };
type HostResult = { ok: true; host: HostState } | { ok: false; code: string };




