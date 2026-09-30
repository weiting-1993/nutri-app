import { logEvent } from './log';

/** 32 random bytes encoded as unpadded base64url. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export type AuthResult = { ok: true; tokenHash: string } | { ok: false; tokenHashPrefix?: string };

export function parseAllowedHashes(raw: string | undefined): Uint8Array[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => HASH_PATTERN.test(h))
    .map(hexToBytes);
}

export async function authenticate(request: Request, rawHashes: string | undefined, route: string): Promise<AuthResult> {
  const allowed = parseAllowedHashes(rawHashes);
  if (allowed.length === 0) {
    logEvent('auth_misconfigured', { route, reason: 'no_valid_hashes_configured' });
    return { ok: false };
  }

  const header = request.headers.get('Authorization');
  const match = header ? /^Bearer ([^\s]+)$/.exec(header) : null;
  const token = match?.[1];
  if (!token) {
    logEvent('auth_failure', { route, reason: header ? 'malformed_header' : 'missing_header' });
    return { ok: false };
  }
  if (!TOKEN_PATTERN.test(token)) {
    logEvent('auth_failure', { route, reason: 'malformed_token' });
    return { ok: false };
  }

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  // Compare against every hash so timing does not reveal which (or whether any) entry matched.
  let matched = 0;
  for (const candidate of allowed) matched |= constantTimeEqual(digest, candidate) ? 1 : 0;

  const tokenHash = bytesToHex(digest);
  if (matched !== 1) {
    logEvent('auth_failure', { route, reason: 'unknown_token', tokenHash: tokenHash.slice(0, 8) });
    return { ok: false, tokenHashPrefix: tokenHash.slice(0, 8) };
  }
  return { ok: true, tokenHash };
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
