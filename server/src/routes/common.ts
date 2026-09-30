import type { z } from 'zod';
import { HttpError } from '../http';
import { logEvent } from '../log';
import type { AiProvider } from '../providers/types';

export interface RouteContext {
  route: string;
  tokenHashPrefix: string;
  provider: AiProvider;
}

export type RouteHandler = (body: unknown, ctx: RouteContext) => Promise<unknown>;

/** Logs only the paths and codes of failing fields, never their values. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.map(String).join('.').slice(0, 60) || '(root)'}:${i.code}`)
    .join(',');
}

export function parseInput<S extends z.ZodType>(schema: S, body: unknown, ctx: RouteContext): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    logEvent('validation_failure', { route: ctx.route, tokenHash: ctx.tokenHashPrefix, reason: describeIssues(result.error) });
    throw new HttpError(400);
  }
  return result.data;
}

export function parseModelOutput<S extends z.ZodType>(schema: S, output: unknown, ctx: RouteContext): z.output<S> {
  const result = schema.safeParse(output);
  if (!result.success) {
    logEvent('model_output_invalid', { route: ctx.route, tokenHash: ctx.tokenHashPrefix, reason: describeIssues(result.error) });
    throw new HttpError(502);
  }
  return result.data;
}
