import { authenticate } from './auth';
import type { Env } from './env';
import { HttpError, errorResponse, isJsonContentType, jsonResponse, readJsonBody } from './http';
import { logEvent } from './log';
import { GeminiProvider } from './providers/gemini';
import { type AiProvider, ProviderError } from './providers/types';
import { checkRateLimit } from './rateLimit';
import { analyzePhoto } from './routes/analyzePhoto';
import type { RouteHandler } from './routes/common';
import { insights } from './routes/insights';
import { parseMeal } from './routes/parseMeal';
import { MAX_BODY_BYTES_DEFAULT, MAX_BODY_BYTES_PHOTO } from './schemas';

export { RateLimiter } from './rateLimit';

interface RouteDef {
  handler: RouteHandler;
  maxBodyBytes: number;
}

const ROUTES: Record<string, RouteDef> = {
  '/v1/parse-meal': { handler: parseMeal, maxBodyBytes: MAX_BODY_BYTES_DEFAULT },
  '/v1/analyze-photo': { handler: analyzePhoto, maxBodyBytes: MAX_BODY_BYTES_PHOTO },
  '/v1/insights': { handler: insights, maxBodyBytes: MAX_BODY_BYTES_DEFAULT },
};

/** Created lazily so input validation still works (400) even if the provider is misconfigured. */
function lazyProvider(env: Env): AiProvider {
  return {
    generateJson: (req) =>
      new GeminiProvider({
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL || 'gemini-3.8-flash',
        fallbackModel: env.GEMINI_FALLBACK_MODEL || undefined,
        thinkingLevel: env.GEMINI_THINKING_LEVEL,
        temperature: env.GEMINI_TEMPERATURE,
      }).generateJson(req),
  };
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const route = url.pathname;
  const def = Object.hasOwn(ROUTES, route) ? ROUTES[route] : undefined;
  if (!def) return errorResponse(404);
  if (request.method !== 'POST') return errorResponse(405, { Allow: 'POST' });

  const auth = await authenticate(request, env.DEVICE_TOKEN_HASHES, route);
  if (!auth.ok) return errorResponse(401);
  const tokenHashPrefix = auth.tokenHash.slice(0, 8);

  let decision;
  try {
    decision = await checkRateLimit(env, auth.tokenHash);
  } catch {
    logEvent('rate_limiter_error', { route, tokenHash: tokenHashPrefix });
    return errorResponse(500);
  }
  if (!decision.allowed) {
    logEvent('rate_limited', { route, tokenHash: tokenHashPrefix });
    return errorResponse(429, decision.retryAfter ? { 'Retry-After': String(decision.retryAfter) } : {});
  }

  if (!isJsonContentType(request.headers.get('Content-Type'))) {
    logEvent('validation_failure', { route, tokenHash: tokenHashPrefix, reason: 'content_type' });
    return errorResponse(415);
  }

  let body: unknown;
  try {
    body = await readJsonBody(request, def.maxBodyBytes);
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    logEvent('validation_failure', { route, tokenHash: tokenHashPrefix, reason: err.status === 413 ? 'body_too_large' : 'body_unreadable' });
    return errorResponse(err.status);
  }

  try {
    const result = await def.handler(body, { route, tokenHashPrefix, provider: lazyProvider(env) });
    return jsonResponse(200, result);
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err.status, err.headers);
    if (err instanceof ProviderError) {
      logEvent('upstream_failure', {
        route,
        tokenHash: tokenHashPrefix,
        reason: err.reason,
        upstreamStatus: err.upstreamStatus,
        upstreamCode: err.upstreamCode,
        model: err.model,
      });
      // Upstream quota (e.g. Gemini free tier) is distinct from our own per-device limit (429).
      if (err.upstreamStatus === 429) return errorResponse(503, { 'Retry-After': '300' });
      return errorResponse(502);
    }
    throw err;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (err) {
      logEvent('unhandled_error', { reason: err instanceof Error ? err.name : 'unknown' });
      return errorResponse(500);
    }
  },
} satisfies ExportedHandler<Env>;
