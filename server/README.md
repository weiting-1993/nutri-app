# nutri-ai – private AI proxy for the nutrition app

A tiny Cloudflare Worker that sits between the two phones and Google Gemini. The Gemini API key lives only here, never in the app. Each phone authenticates with its own secret device token; requests are validated, rate-limited, and the AI's answers are checked before they reach the app.

## One-time setup

You need Node.js 20+ and a free Cloudflare account.

1. **Google Gemini API key (paid tier)**
   1. Go to <https://aistudio.google.com>, sign in, and create an API key (Get API key → Create API key).
   2. In AI Studio, set up billing for that project (Settings → Billing / "Upgrade"). On the paid tier, Google does **not** use your prompts or photos to train its models. The free tier does.
      To just try it out, you can skip billing and use the free tier with the same setup. Expect lower daily limits, and Google may use what you send to improve its products. Enable billing later on the same key; nothing else changes.
   3. Recommended: in Google Cloud Console → Billing → Budgets & alerts, create a budget of e.g. €10/month with email alerts.
2. **Install**
   ```bash
   cd server
   pnpm install
   pnpm wrangler login          # opens the browser to log in to Cloudflare
   ```
3. **Store the Gemini key as a secret** (paste it when prompted; it is never written to a file):
   ```bash
   pnpm wrangler secret put GEMINI_API_KEY
   ```
4. **Create one device token per phone**
   ```bash
   pnpm gen-token   # phone 1
   pnpm gen-token   # phone 2
   ```
   Each run prints a `TOKEN` (goes into that phone's app settings) and a `HASH`. Then store both hashes, comma-separated:
   ```bash
   pnpm wrangler secret put DEVICE_TOKEN_HASHES
   # paste: <hash-phone-1>,<hash-phone-2>
   ```
   Don't keep the tokens in chat logs, notes or email once they're entered in the phones.
5. **Deploy**
   ```bash
   pnpm run deploy
   ```
   Wrangler prints a URL like `https://nutri-ai.<your-subdomain>.workers.dev`. Enter that URL in the app together with the token.

The first `wrangler secret put` may ask to create the Worker. Answer yes. If you want to check that everything works, run `pnpm test`.

## Day-to-day

| Task | How |
| --- | --- |
| Revoke a lost phone | `pnpm wrangler secret put DEVICE_TOKEN_HASHES` with only the remaining hash(es). Takes effect within seconds; no code deploy needed. |
| Add or replace a phone | `pnpm gen-token`, then put the new full hash list as above. |
| Rotate the Gemini key | Create a new key in AI Studio, `pnpm wrangler secret put GEMINI_API_KEY`, then delete the old key in AI Studio. |
| Change model / limits | Edit `vars` in `wrangler.jsonc` (`GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` (used for the one retry when the main model is overloaded), `RATE_LIMIT_HOURLY`, `RATE_LIMIT_DAILY`), then `pnpm run deploy`. See "Capping Gemini usage". |
| Watch logs | `pnpm wrangler tail` (security events only; never meal text, photos, tokens or keys). |
| Local dev | `cp .dev.vars.example .dev.vars`, fill in values, `pnpm dev`. |

## API (all `POST`, JSON, `Authorization: Bearer <device token>`)

| Route | Body | Response |
| --- | --- | --- |
| `/v1/parse-meal` | `{ text: 1..1000 chars, locale?: "de"\|"en" }` | `{ items: FoodItem[] }` (max 20) |
| `/v1/analyze-photo` | `{ mode: "plate"\|"label", image_base64, mime_type: "image/jpeg"\|"image/png", note?: 1..500 chars (plate only), locale? }` | plate → `{ items: FoodItem[] }`, label → `{ label: Label \| null }` |
| `/v1/insights` | `{ days: 1..31, nutrients: [...] (max 60), topFoods: [...] (max 30), locale? }` | `{ insights: [{ title, body, kind }] }` (max 5) |

`FoodItem = { name_en, name_de, quantity, unit, grams_estimate: number|null, confidence: "high"|"medium"|"low", per_100g: Estimate|null }`

`Estimate = { energy_kcal, protein_g, carbs_g, fat_g, fiber_g, sugars_g, sat_fat_g, sodium_mg }` per 100 g as prepared (each nullable except energy). Implausible estimates (energy > 900 kcal or protein + carbs + fat > 100 g per 100 g) are replaced by `null`. The app uses the estimate by default and offers database matches as an alternative.

Errors are always `{ "error": "<generic message>" }` with status 400, 401, 404, 405, 413, 415, 429 (this server's per-device limit, with a `Retry-After` header in seconds), 500, 502, or 503 (Gemini's own quota is used up, e.g. on the free tier; `Retry-After: 300`).

Image limits: base64 without a `data:` prefix, at most 1.5 MiB decoded. Resize to about 1024 px on the long side, JPEG quality around 0.7 (typically 100–250 KB).

## Security design (short)

- **Auth:** 256-bit random tokens per phone. Only SHA-256 hashes are stored (as a Worker secret) and compared in constant time. Fails closed if no hashes are configured.
- **Rate limit:** 20 requests/hour and 40/day per token (configurable), using a SQLite-backed **Durable Object** (one per token). The Cloudflare Rate Limiting binding only supports 10 s/60 s windows, and KV is eventually consistent (bursts could slip through). A Durable Object is strongly consistent and runs on the free plan. The tradeoff is a few milliseconds of extra latency. If the limiter is unreachable, requests are refused (500).
- **Input:** Content-Type must be `application/json`. Body limit is 32 KB (2.3 MB for photos), checked against both Content-Length and the bytes actually read. Every body goes through strict zod validation (unknown fields are rejected). Text has control, zero-width and bidi characters and `<` `>` removed. Base64 is validated, and the image's magic bytes must match `mime_type`.
- **Prompt injection:** user text is wrapped in `<<<USER_DATA_BEGIN>>> … <<<USER_DATA_END>>>`. Since `<` and `>` are stripped from input, it can't forge these markers. The system prompt says the content is data and any instructions inside it must be ignored.
- **Model output:** validated with zod (types, enums, numeric bounds). Strings are sanitised and clamped. Anything invalid becomes a 502.
- **Responses:** no CORS headers (native app only). `nosniff`, `no-store`, a strict CSP, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and HSTS on every response. Upstream error text is never forwarded.
- **Gemini calls:** the key goes in the `x-goog-api-key` header (never in the URL), with a 25 s total timeout (one retry when Gemini answers 500/503 "overloaded"), `maxOutputTokens` 4096 and redirects refused. The legacy-but-supported `generateContent` endpoint is used; it does not store requests server-side (the newer Interactions API stores them for 55 days unless `store=false`).

## Privacy

Only what's needed for each request goes to Google: the typed or dictated meal text, the photo, or aggregated nutrient averages plus top food names (for insights). No names, emails, profile data, device IDs or tokens are sent. With a paid-tier key, Google does not use this data to train models; it may retain it for a limited time for abuse monitoring. Cloudflare logs only security metadata (timestamp, route, an 8-character token-hash prefix, reason).

## Cost estimate

Cloudflare: the free Workers plan is enough (100k requests/day, SQLite Durable Objects included).

Gemini 3.8 Flash is priced at $0.75 / 1M input tokens and $3.75 / 1M output tokens until 2026-12-31, then $1.50 / $7.50. Rough token use per request:

- text parse: ~1k input / ~0.5k output
- photo: ~2k input / ~0.5k output
- insights: ~1.5k input / ~0.8k output

| Usage (both people together) | Until 2026-12-31 | From 2027 |
| --- | --- | --- |
| Light: ~10 requests/day | ≈ €1/month | ≈ €2/month |
| Typical: ~20 requests/day | ≈ €2/month | ≈ €4/month |

The rate limit caps the worst case (both phones maxing out 40/day, every day) at roughly €0.30/day, about €8/month until 2026-12-31 and €16/month after. Budget alerts only notify you; for a hard stop on Google's side, lower the Generative Language API quota (see "Capping Gemini usage").

## Capping Gemini usage

1. **This server (hard cap, per phone):** `RATE_LIMIT_HOURLY` / `RATE_LIMIT_DAILY` in `wrangler.jsonc` (default 20/40), then `pnpm run deploy`.
2. **Google (hard cap, whole project):** Google Cloud Console → select the project → APIs & Services → Generative Language API → Quotas & system limits → edit the requests-per-day quota for the model and set a lower value. Requests beyond it are refused; the app then says the provider's limit is used up.
3. **Google (alert only):** Billing → Budgets & alerts, e.g. €5/month with email alerts. A budget does not stop spending on its own.
4. **Free tier:** with no billing account linked, Google can't charge anything; requests simply stop at the free daily limit.

## Project layout

```
src/index.ts            router, auth → rate limit → content-type → body → handler
src/auth.ts             device-token verification
src/rateLimit.ts        RateLimiter Durable Object + client
src/schemas.ts          zod schemas (requests + model output) and JSON Schemas for Gemini
src/prompts.ts          system prompts
src/providers/types.ts  provider interface (add providers/mistral.ts to switch)
src/providers/gemini.ts Gemini REST adapter
src/routes/*.ts         one handler per endpoint
scripts/gen-token.mjs   token generator
test/*.test.ts          vitest suite (mocked Gemini + in-memory rate limiter)
```
