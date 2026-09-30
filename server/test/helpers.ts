import { createHash, randomBytes } from 'node:crypto';
import { vi } from 'vitest';
import type { Env } from '../src/env';
import worker from '../src/index';
import { RateLimiter } from '../src/rateLimit';

export const BASE = 'https://nutri-ai.test';
export const API_KEY = 'test-gemini-key-SECRET-123';

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function makeToken(): { token: string; hash: string } {
  const token = toBase64(randomBytes(32)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { token, hash: toHex(createHash('sha256').update(token, 'utf8').digest()) };
}

export const PHONE_A = makeToken();
export const PHONE_B = makeToken();

class MemoryStorage {
  private readonly data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.data.get(key)) as T | undefined;
  }
  async put(entries: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(entries)) this.data.set(k, structuredClone(v));
  }
}

/** In-memory stand-in for the RATE_LIMITER Durable Object namespace, running the real class. */
export function fakeRateLimiterNamespace(): DurableObjectNamespace {
  const instances = new Map<string, RateLimiter>();
  return {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({
      fetch: async (url: string, init?: RequestInit) => {
        let instance = instances.get(id.name);
        if (!instance) {
          instance = new RateLimiter({ storage: new MemoryStorage() } as unknown as DurableObjectState, {});
          instances.set(id.name, instance);
        }
        return instance.fetch(new Request(url, init));
      },
    }),
  } as unknown as DurableObjectNamespace;
}

/** Limiter stub that always returns the given response. */
export function stubRateLimiterNamespace(respond: () => Response | Promise<Response>): DurableObjectNamespace {
  return {
    idFromName: (name: string) => ({ name }),
    get: () => ({ fetch: async () => respond() }),
  } as unknown as DurableObjectNamespace;
}

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GEMINI_API_KEY: API_KEY,
    DEVICE_TOKEN_HASHES: `${PHONE_A.hash}, ${PHONE_B.hash}`,
    GEMINI_MODEL: 'gemini-3.8-flash',
    GEMINI_THINKING_LEVEL: 'LOW',
    GEMINI_TEMPERATURE: '',
    RATE_LIMIT_HOURLY: '60',
    RATE_LIMIT_DAILY: '300',
    RATE_LIMITER: fakeRateLimiterNamespace(),
    ...overrides,
  };
}

interface CallOptions {
  method?: string;
  token?: string | null;
  authorization?: string;
  contentType?: string | null;
  body?: unknown;
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  env?: Env;
}

export async function call(path: string, opts: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers };
  const token = opts.token === undefined ? PHONE_A.token : opts.token;
  if (opts.authorization !== undefined) headers.Authorization = opts.authorization;
  else if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (opts.contentType !== null) headers['Content-Type'] = opts.contentType ?? 'application/json';

  const method = opts.method ?? 'POST';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  const init: RequestInit & { duplex?: 'half' } = { method, headers, body: hasBody ? body : undefined };
  if (body instanceof ReadableStream) init.duplex = 'half';
  const request = new Request(`${BASE}${path}`, init);
  return worker.fetch(request, opts.env ?? makeEnv());
}

export function geminiReply(output: unknown, finishReason = 'STOP'): Response {
  const text = typeof output === 'string' ? output : JSON.stringify(output);
  return Response.json({
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
  });
}

/** Replaces global fetch (used by the Gemini adapter) with a mock. */
export function mockGemini(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => respond(String(input), init ?? {}));
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function upstreamBody(fn: ReturnType<typeof mockGemini>, callIndex = 0): any {
  const init = fn.mock.calls[callIndex]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

export function jpegBase64(totalBytes = 64): string {
  const bytes = Buffer.alloc(totalBytes, 0x11);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  return bytes.toString('base64');
}

export function pngBase64(totalBytes = 64): string {
  const bytes = Buffer.alloc(totalBytes, 0x22);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes.toString('base64');
}

export const SECURITY_HEADER_EXPECTATIONS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
};
