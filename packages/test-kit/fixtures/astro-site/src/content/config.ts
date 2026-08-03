import { defineCollection, z } from 'astro:content';

const deals = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    visibility: z.enum(['public', 'private']).default('private'),
  }),
});

export const collections = { deals };
