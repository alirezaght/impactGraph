#!/usr/bin/env node
// edge-cases.ts — analyzer edge cases. Expected effective lines: 9.
import {
  basename,
  dirname,
} from 'node:path';

export type { Options } from './under-limit.js';
export * from './under-limit.js';

export const templateWithMarkers = `
// this is not a comment, it is template text
/* neither is this */
`;

export const stringWithMarker = '/* not a comment */ and // also not';

export function pathParts(input: string): [string, string] {
  return [
    dirname(input),
    basename(input),
  ];
}
