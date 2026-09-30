import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_KEY,
  PHONE_A,
  PHONE_B,
  SECURITY_HEADER_EXPECTATIONS,
  call,
  geminiReply,
  makeEnv,
  makeToken,
  mockGemini,
  stubRateLimiterNamespace,
} from './helpers';

const MEAL = { text: '2 Brötchen mit Butter', locale: 'de' };
const OK_ITEMS = { items: [] };

function expectSecurityHeaders(res: Response) {
  for (const [name, value] of Object.entries(SECURITY_HEADER_EXPECTATIONS)) expect(res.headers.get(name)).toBe(value);
  for (const name of res.headers.keys()) expect(name.startsWith('access-control-')).toBe(false);
}

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

function logLines(): Record<string, unknown>[] {
  return logSpy.mock.calls.map((c: unknown[]) => JSON.parse(String(c[0])));
}

describe('routing', () => {
  it('404 for unknown routes, regardless of method', async () => {
    for (const [path, method] of [
      ['/', 'GET'],
      ['/v1/unknown', 'POST'],
      ['/v1/parse-meal/', 'POST'],
      ['/__proto__', 'POST'],
      ['/constructor', 'POST'],
    ] as const) {
      const res = await call(path, { method, body: method === 'POST' ? MEAL : undefined });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not found' });
      expectSecurityHeaders(res);
    }
  });

  it('405 with Allow: POST for non-POST methods on known routes', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
      const res = await call('/v1/parse-meal', { method });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
      expectSecurityHeaders(res);
    }
  });
});

describe('authentication', () => {
  const cases: [string, Parameters<typeof call>[1]][] = [
    ['missing header', { token: null }],
    ['unknown but well-formed token', { token: makeToken().token }],
    ['malformed token (too short)', { token: 'abc' }],
    ['token with invalid characters', { token: `${PHONE_A.token.slice(0, 42)}!` }],
    ['hash instead of token', { token: PHONE_A.hash }],
    ['wrong scheme', { authorization: `Basic ${PHONE_A.token}` }],
    ['lowercase scheme', { authorization: `bearer ${PHONE_A.token}` }],
    ['extra segment', { authorization: `Bearer ${PHONE_A.token} x` }],
    ['empty bearer', { authorization: 'Bearer ' }],
  ];

  it.each(cases)('401 for %s, without data and without calling the model', async (_name, opts) => {
    const gemini = mockGemini(() => geminiReply(OK_ITEMS));
    const res = await call('/v1/parse-meal', { ...opts, body: MEAL });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expectSecurityHeaders(res);
    expect(gemini).not.toHaveBeenCalled();
  });

  it('401 for everyone when no valid hashes are configured (fail closed)', async () => {
    for (const hashes of ['', 'not-a-hash', ' , ']) {
      const res = await call('/v1/parse-meal', { body: MEAL, env: makeEnv({ DEVICE_TOKEN_HASHES: hashes }) });
      expect(res.status).toBe(401);
    }
  });

  it('accepts both configured phones and rejects a revoked one', async () => {
    mockGemini(() => geminiReply(OK_ITEMS));
    expect((await call('/v1/parse-meal', { body: MEAL, token: PHONE_A.token })).status).toBe(200);
    expect((await call('/v1/parse-meal', { body: MEAL, token: PHONE_B.token })).status).toBe(200);

    const revoked = makeEnv({ DEVICE_TOKEN_HASHES: PHONE_A.hash });
    expect((await call('/v1/parse-meal', { body: MEAL, token: PHONE_B.token, env: revoked })).status).toBe(401);
  });

  it('logs auth failures with a hash prefix only, never the token', async () => {
    const intruder = makeToken();
    await call('/v1/parse-meal', { body: MEAL, token: intruder.token });
    const lines = logLines();
    expect(lines).toContainEqual(expect.objectContaining({ event: 'auth_failure', route: '/v1/parse-meal', tokenHash: intruder.hash.slice(0, 8) }));
    const raw = logSpy.mock.calls.flat().join('\n');
    expect(raw).not.toContain(intruder.token);
    expect(raw).not.toContain(intruder.hash);
  });
});

describe('content type and body size', () => {
  it('415 for non-JSON content types', async () => {
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/json; charset=latin1', null]) {
      const res = await call('/v1/parse-meal', { contentType, rawBody: JSON.stringify(MEAL) });
      expect(res.status).toBe(415);
      expectSecurityHeaders(res);
    }
  });

  it('accepts application/json with utf-8 charset', async () => {
    mockGemini(() => geminiReply(OK_ITEMS));
    const res = await call('/v1/parse-meal', { contentType: 'application/json; charset=UTF-8', body: MEAL });
    expect(res.status).toBe(200);
  });

  it('413 when Content-Length exceeds the limit', async () => {
    const res = await call('/v1/parse-meal', { body: MEAL, headers: { 'Content-Length': '40000' } });
    expect(res.status).toBe(413);
    expectSecurityHeaders(res);
  });

  it('413 when the actual body exceeds the limit even without Content-Length', async () => {
    const big = JSON.stringify({ text: 'a'.repeat(40_000) });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const res = await call('/v1/parse-meal', {
      rawBody: stream,
      headers: {},
    });
    expect(res.status).toBe(413);
  });

  it('413 for photo bodies above ~2.2 MB', async () => {
    const res = await call('/v1/analyze-photo', {
      rawBody: JSON.stringify({ mode: 'plate', mime_type: 'image/jpeg', image_base64: 'A'.repeat(2_400_000) }),
    });
    expect(res.status).toBe(413);
  });

  it('400 for malformed JSON or empty body', async () => {
    for (const rawBody of ['{"text": "x"', 'null', '', '"just a string"', '[]']) {
      const res = await call('/v1/parse-meal', { rawBody });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid request' });
    }
  });
});

describe('rate limiting', () => {
  it('429 with Retry-After after exceeding the hourly limit (real limiter logic, in-memory storage)', async () => {
    mockGemini(() => geminiReply(OK_ITEMS));
    const env = makeEnv({ RATE_LIMIT_HOURLY: '3' });
    for (let i = 0; i < 3; i++) expect((await call('/v1/parse-meal', { body: MEAL, env })).status).toBe(200);

    const res = await call('/v1/parse-meal', { body: MEAL, env });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'Too many requests' });
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expectSecurityHeaders(res);
    expect(logLines()).toContainEqual(expect.objectContaining({ event: 'rate_limited', tokenHash: PHONE_A.hash.slice(0, 8) }));

    // The other phone has its own budget.
    expect((await call('/v1/parse-meal', { body: MEAL, env, token: PHONE_B.token })).status).toBe(200);
  });

  it('429 when the (mocked) limiter denies, without calling the model', async () => {
    const gemini = mockGemini(() => geminiReply(OK_ITEMS));
    const env = makeEnv({ RATE_LIMITER: stubRateLimiterNamespace(() => Response.json({ allowed: false, retryAfter: 120 })) });
    const res = await call('/v1/insights', { body: { days: 7, nutrients: [], topFoods: [] }, env });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('120');
    expect(gemini).not.toHaveBeenCalled();
  });

  it('fails closed (500) when the limiter is unavailable', async () => {
    const gemini = mockGemini(() => geminiReply(OK_ITEMS));
    const env = makeEnv({ RATE_LIMITER: stubRateLimiterNamespace(() => new Response('boom', { status: 500 })) });
    const res = await call('/v1/parse-meal', { body: MEAL, env });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Something went wrong' });
    expect(gemini).not.toHaveBeenCalled();
  });
});

describe('logging hygiene', () => {
  it('never logs tokens, API key, meal text or model output', async () => {
    const secretMeal = 'Geheimes Frühstück mit Trüffel';
    mockGemini(() => new Response(`upstream says ${API_KEY}`, { status: 500 }));
    const res = await call('/v1/parse-meal', { body: { text: secretMeal } });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain('upstream says');

    mockGemini(() => geminiReply({ items: [{ name_en: 'MODEL-OUTPUT-MARKER', quantity: 99999 }] }));
    await call('/v1/parse-meal', { body: { text: secretMeal } });

    const raw = logSpy.mock.calls.flat().join('\n');
    expect(raw).not.toContain(PHONE_A.token);
    expect(raw).not.toContain(API_KEY);
    expect(raw).not.toContain('Trüffel');
    expect(raw).not.toContain('MODEL-OUTPUT-MARKER');
    expect(raw).not.toContain('upstream says');
    for (const line of logLines()) {
      expect(line).toHaveProperty('ts');
      expect(line).toHaveProperty('event');
    }
  });
});
