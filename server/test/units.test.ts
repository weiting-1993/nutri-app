import { describe, expect, it, vi } from 'vitest';
import { constantTimeEqual, parseAllowedHashes } from '../src/auth';
import { GeminiProvider } from '../src/providers/gemini';
import { checkAndIncrement } from '../src/rateLimit';
import { sanitizeText, truncate } from '../src/sanitize';
import { geminiReply } from './helpers';

class MemoryStorage {
  data = new Map<string, unknown>();
  async get<T>(key: string) {
    return this.data.get(key) as T | undefined;
  }
  async put(entries: Record<string, unknown>) {
    for (const [k, v] of Object.entries(entries)) this.data.set(k, structuredClone(v));
  }
}

const storage = () => new MemoryStorage() as unknown as Parameters<typeof checkAndIncrement>[0];
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe('checkAndIncrement', () => {
  it('enforces the hourly limit and resets in the next hour', async () => {
    const s = storage();
    const t0 = 10 * DAY + 5 * HOUR + 1000;
    for (let i = 0; i < 3; i++) expect((await checkAndIncrement(s, { hourly: 3, daily: 100 }, t0)).allowed).toBe(true);
    const denied = await checkAndIncrement(s, { hourly: 3, daily: 100 }, t0);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBe(Math.ceil((HOUR - 1000) / 1000));
    expect((await checkAndIncrement(s, { hourly: 3, daily: 100 }, t0 + HOUR)).allowed).toBe(true);
  });

  it('enforces the daily limit across hours and resets the next UTC day', async () => {
    const s = storage();
    const day = 20 * DAY;
    for (let h = 0; h < 5; h++) expect((await checkAndIncrement(s, { hourly: 60, daily: 5 }, day + h * HOUR)).allowed).toBe(true);
    const denied = await checkAndIncrement(s, { hourly: 60, daily: 5 }, day + 6 * HOUR);
    expect(denied).toEqual({ allowed: false, retryAfter: 18 * 3600 });
    expect((await checkAndIncrement(s, { hourly: 60, daily: 5 }, day + DAY)).allowed).toBe(true);
  });

  it('does not count denied requests', async () => {
    const s = storage();
    const t = 30 * DAY;
    await checkAndIncrement(s, { hourly: 1, daily: 2 }, t);
    for (let i = 0; i < 10; i++) await checkAndIncrement(s, { hourly: 1, daily: 2 }, t);
    expect((await checkAndIncrement(s, { hourly: 1, daily: 2 }, t + HOUR)).allowed).toBe(true);
  });
});

describe('auth helpers', () => {
  it('constantTimeEqual', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('parseAllowedHashes ignores malformed entries and normalises case/whitespace', () => {
    const good = 'A'.repeat(64);
    expect(parseAllowedHashes(` ${good} , nope, ${'b'.repeat(63)}, ,${'c'.repeat(64)}`)).toHaveLength(2);
    expect(parseAllowedHashes(undefined)).toEqual([]);
  });
});

describe('sanitize', () => {
  it('removes control, zero-width and bidi characters and angle brackets', () => {
    expect(sanitizeText(' a\u0000b\u200Bc\u202Ed<e>\n\nf ')).toBe('a b c de f');
  });

  it('truncate does not split surrogate pairs', () => {
    expect(truncate('ab🍎', 3)).toBe('ab');
    expect(truncate('abc', 5)).toBe('abc');
  });
});

describe('GeminiProvider retry', () => {
  const REQ = { system: 's', userText: 'u', schema: {} };
  const provider = (fetchImpl: typeof fetch, timeoutMs?: number) =>
    new GeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', fetchImpl, retryDelayMs: 0, timeoutMs });

  it.each([500, 503])('retries once after an upstream %i and returns the second answer', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('busy', { status })).mockResolvedValueOnce(geminiReply({ ok: 1 }));
    await expect(provider(fetchImpl).generateJson(REQ)).resolves.toEqual({ ok: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries on the fallback model when one is configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('busy', { status: 503 })).mockResolvedValueOnce(geminiReply({ ok: 1 }));
    const p = new GeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', fallbackModel: 'gemini-3.5-flash-lite', fetchImpl, retryDelayMs: 0 });
    await expect(p.generateJson(REQ)).resolves.toEqual({ ok: 1 });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('/gemini-3.8-flash:generateContent');
    expect(String(fetchImpl.mock.calls[1]![0])).toContain('/gemini-3.5-flash-lite:generateContent');
  });

  it('switches to the fallback model when the main model quota is used up (429), without waiting', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('quota', { status: 429 })).mockResolvedValueOnce(geminiReply({ ok: 1 }));
    const p = new GeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', fallbackModel: 'gemini-3.5-flash-lite', fetchImpl, retryDelayMs: 60_000 });
    await expect(p.generateJson(REQ)).resolves.toEqual({ ok: 1 });
    expect(String(fetchImpl.mock.calls[1]![0])).toContain('/gemini-3.5-flash-lite:generateContent');
  });

  it('reports only the enum-like upstream code and the model that failed, never message text', async () => {
    const body = JSON.stringify({ error: { code: 400, message: 'secret detail k=abc', status: 'INVALID_ARGUMENT' } });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body, { status: 400 }));
    const err = await provider(fetchImpl).generateJson(REQ).catch((e: unknown) => e);
    expect(err).toMatchObject({ reason: 'http_error', upstreamStatus: 400, upstreamCode: 'INVALID_ARGUMENT/other', model: 'gemini-3.8-flash' });
    expect(JSON.stringify(err) + String(err)).not.toContain('secret detail');
  });

  it('adds a fixed topic from the upstream message without its text', async () => {
    const message = 'The specified schema produces a constraint that has too many states. user said: noodles';
    const body = JSON.stringify({ error: { message, status: 'INVALID_ARGUMENT' } });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body, { status: 400 }));
    const err = await provider(fetchImpl).generateJson(REQ).catch((e: unknown) => e);
    expect(err).toMatchObject({ upstreamCode: 'INVALID_ARGUMENT/schema' });
    expect(JSON.stringify(err) + String(err)).not.toContain('noodles');
  });

  it('ignores an upstream code that is not enum-like', async () => {
    const body = JSON.stringify({ error: { status: 'drop table; <script>' } });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body, { status: 400 }));
    await expect(provider(fetchImpl).generateJson(REQ)).rejects.toMatchObject({ upstreamCode: undefined });
  });

  it('rejects a malformed fallback model id', () => {
    expect(() => new GeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', fallbackModel: '../x?key=1' })).toThrow();
  });

  it('gives up after the single retry', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('busy', { status: 503 }));
    await expect(provider(fetchImpl).generateJson(REQ)).rejects.toMatchObject({ reason: 'http_error', upstreamStatus: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([400, 429])('does not retry an upstream %i', async (status) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('no', { status }));
    await expect(provider(fetchImpl).generateJson(REQ)).rejects.toMatchObject({ upstreamStatus: status });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('skips the retry when too little time budget is left', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('busy', { status: 503 }));
    await expect(provider(fetchImpl, 5_000).generateJson(REQ)).rejects.toMatchObject({ upstreamStatus: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
