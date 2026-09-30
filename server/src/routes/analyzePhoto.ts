import { labelPrompt, platePrompt } from '../prompts';
import { analyzePhotoRequest, itemsJsonSchema, itemsOutput, labelJsonSchema, labelOutput } from '../schemas';
import { parseInput, parseModelOutput, type RouteHandler } from './common';

export const analyzePhoto: RouteHandler = async (body, ctx) => {
  const input = parseInput(analyzePhotoRequest, body, ctx);
  const image = { imageBase64: input.image_base64, mimeType: input.mime_type };

  if (input.mode === 'label') {
    const raw = await ctx.provider.generateJson({ ...labelPrompt(input.locale), ...image, schema: labelJsonSchema });
    return parseModelOutput(labelOutput, raw, ctx);
  }
  const raw = await ctx.provider.generateJson({ ...platePrompt(input.locale, input.note), ...image, schema: itemsJsonSchema });
  return parseModelOutput(itemsOutput, raw, ctx);
};
