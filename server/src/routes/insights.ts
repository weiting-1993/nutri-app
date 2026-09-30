import { insightsPrompt } from '../prompts';
import { insightsJsonSchema, insightsOutput, insightsRequest } from '../schemas';
import { parseInput, parseModelOutput, type RouteHandler } from './common';

export const insights: RouteHandler = async (body, ctx) => {
  const input = parseInput(insightsRequest, body, ctx);
  const raw = await ctx.provider.generateJson({ ...insightsPrompt(input), schema: insightsJsonSchema });
  return parseModelOutput(insightsOutput, raw, ctx);
};
