import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Transformations acting on a value, detected from the code that performs them (item 7: "Expose
 * transformations such as null removal, row skipping, fallback behavior, merge behavior, and
 * serialization when the code provides evidence").
 *
 * These are the behaviours the trials said went unreported, and they are exactly the ones a diff
 * review cannot see: each is a few lines, none changes a signature, and together they mean "a record
 * with no expiry silently disappears".
 *
 * Detection is textual and line-anchored, and every match reports the line so a reader can check it —
 * the point is to make the reader look at the right five lines, not to be authoritative. A pattern
 * that matches nothing produces nothing; nothing is inferred from absence.
 */

export const TRANSFORMATION_KINDS = [
  /** Null/undefined-valued keys removed from an object, so the field becomes ABSENT. */
  'null-removal',
  /** A record skipped entirely on a missing or falsy value. The silent-disappearance case. */
  'row-skip',
  /** A default supplied for an absent value — which masks a removal upstream. */
  'fallback',
  /** Objects merged, so precedence decides whose value survives. */
  'merge',
  /** Serialized or deserialized across a boundary. */
  'serialization',
] as const;

export type TransformationKind = (typeof TRANSFORMATION_KINDS)[number];

export interface DetectedTransformation {
  readonly kind: TransformationKind;
  readonly path: string;
  readonly line: number;
  /** The source line, trimmed. The evidence, verbatim. */
  readonly excerpt: string;
  readonly note: string;
}

interface Rule {
  readonly kind: TransformationKind;
  readonly pattern: RegExp;
  readonly note: string;
}

const RULES: readonly Rule[] = [
  {
    kind: 'null-removal',
    pattern:
      /!==\s*(null|undefined)|!=\s*null|filter\((?:[^)]*)(null|undefined)|omitBy|compact|removeNull|pickBy/,
    note: 'a null or undefined value is removed here, so the field becomes ABSENT downstream rather than null',
  },
  {
    kind: 'row-skip',
    pattern: /^\s*(continue|return)\s*;?\s*$|\bcontinue\b\s*;/,
    note: 'a record is skipped here — downstream consumers see one fewer row, with nothing logged',
  },
  {
    kind: 'fallback',
    pattern: /\?\?|\|\|\s*['"{[]|default(s|Value)?\s*[:=]|getOrElse|orElse/,
    note: 'a default is supplied here, which masks an upstream removal for anything that has one',
  },
  {
    kind: 'merge',
    pattern: /\{\s*\.\.\.[A-Za-z_$]|Object\.assign|merge(Defaults|With)?\(/,
    note: 'objects are merged here, so precedence decides whose value survives',
  },
  {
    kind: 'serialization',
    pattern: /JSON\.(parse|stringify)|res\.json\(|\.json\(\)|toJSON|fromJSON|serialize|deserialize/,
    note: 'the value crosses a serialization boundary here',
  },
];

/** Pure: detect transformations in one file's text. Line numbers are 1-based. */
export const detectTransformations = (
  path: string,
  content: string,
): readonly DetectedTransformation[] => {
  const found: DetectedTransformation[] = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    // A comment is not behaviour. Skipping comment lines matters here specifically: this file's own
    // documentation would otherwise match every rule it describes.
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        found.push({
          kind: rule.kind,
          path,
          line: index + 1,
          excerpt: trimmed.slice(0, 160),
          note: rule.note,
        });
      }
    }
  }
  return found;
};

const MAX_FILES = 12;

/**
 * Detect transformations across the files a flow touches.
 *
 * Reads the working-tree files, which is deliberate: the transformation is a property of the code as
 * it stands, and a reader following a field-flow answer is going to open those files. Reading is
 * static — nothing is executed (PRD §35) — and files that no longer exist are skipped rather than
 * guessed at.
 */
export const transformationsForPaths = (
  rootDir: string,
  paths: readonly string[],
): readonly DetectedTransformation[] => {
  const found: DetectedTransformation[] = [];
  for (const path of [...new Set(paths)].slice(0, MAX_FILES)) {
    const absolute = join(rootDir, path);
    if (!absolute.startsWith(rootDir) || !existsSync(absolute)) {
      continue;
    }
    try {
      found.push(...detectTransformations(path, readFileSync(absolute, 'utf8')));
    } catch {
      continue; // an unreadable file costs its transformations, never the query
    }
  }
  return found;
};
