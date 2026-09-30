export class HttpError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'status' | 'too_large' | 'invalid_json',
    readonly status?: number,
  ) {
    super(kind === 'status' ? `HTTP ${status}` : kind);
  }
}

/** fetch + timeout + response size cap + JSON parse. Throws HttpError. */
export async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ status: number; json: unknown; headers: Headers }> {
  const { timeoutMs = 15_000, maxBytes = 2_000_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: controller.signal, redirect: 'error' });
  } catch {
    throw new HttpError(controller.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > maxBytes) throw new HttpError('too_large');
  const text = await res.text();
  if (text.length > maxBytes) throw new HttpError('too_large');
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      if (res.ok) throw new HttpError('invalid_json');
    }
  }
  return { status: res.status, json, headers: res.headers };
}
