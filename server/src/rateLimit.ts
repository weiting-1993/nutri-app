import type { Env } from './env';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the blocking window resets (only when not allowed). */
  retryAfter?: number;
}

interface Counter {
  window: number;
  count: number;
}

interface CheckRequest {
  hourly: number;
  daily: number;
}

/**
 * One Durable Object instance per device token hash. Durable Objects process storage
 * operations for a single instance serially, so the read-check-increment below is atomic.
 * Fixed windows: current clock hour and current UTC day.
 */
export class RateLimiter implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    _env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as CheckRequest;
    const decision = await checkAndIncrement(this.state.storage, body, Date.now());
    return Response.json(decision);
  }
}

export async function checkAndIncrement(
  storage: Pick<DurableObjectStorage, 'get' | 'put'>,
  limits: CheckRequest,
  now: number,
): Promise<RateLimitDecision> {
  const hourWindow = Math.floor(now / HOUR_MS);
  const dayWindow = Math.floor(now / DAY_MS);

  const storedHour = await storage.get<Counter>('hour');
  const storedDay = await storage.get<Counter>('day');
  const hour: Counter = storedHour?.window === hourWindow ? storedHour : { window: hourWindow, count: 0 };
  const day: Counter = storedDay?.window === dayWindow ? storedDay : { window: dayWindow, count: 0 };

  if (day.count >= limits.daily) {
    return { allowed: false, retryAfter: Math.ceil(((dayWindow + 1) * DAY_MS - now) / 1000) };
  }
  if (hour.count >= limits.hourly) {
    return { allowed: false, retryAfter: Math.ceil(((hourWindow + 1) * HOUR_MS - now) / 1000) };
  }

  hour.count += 1;
  day.count += 1;
  await storage.put({ hour, day });
  return { allowed: true };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export async function checkRateLimit(env: Env, tokenHash: string): Promise<RateLimitDecision> {
  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(tokenHash));
  const res = await stub.fetch('https://rate-limiter.internal/check', {
    method: 'POST',
    body: JSON.stringify({
      hourly: positiveInt(env.RATE_LIMIT_HOURLY, 20),
      daily: positiveInt(env.RATE_LIMIT_DAILY, 40),
    } satisfies CheckRequest),
  });
  if (!res.ok) throw new Error('rate limiter unavailable');
  const decision = (await res.json()) as RateLimitDecision;
  if (typeof decision.allowed !== 'boolean') throw new Error('rate limiter bad response');
  return decision;
}
