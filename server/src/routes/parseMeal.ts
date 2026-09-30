import { parseMealPrompt } from '../prompts';
import { itemsJsonSchema, itemsOutput, parseMealRequest } from '../schemas';
import { parseInput, parseModelOutput, type RouteHandler } from './common';

export const parseMeal: RouteHandler = async (body, ctx) => {
  const input = parseInput(parseMealRequest, body, ctx);
  const prompt = parseMealPrompt(input.text, input.locale);
  const raw = await ctx.provider.generateJson({ ...prompt, schema: itemsJsonSchema });
  return parseModelOutput(itemsOutput, raw, ctx);
};
