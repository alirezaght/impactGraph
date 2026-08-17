/**
 * Lightweight secret scanner (`pnpm quality:secrets`).
 *
 * Modes:
 *   --staged  scan only lines added in the staged diff (pre-commit hook lane)
 *   default   scan repository files (fast-glob, shared ignore globs)
 *
 * Matched values are NEVER printed — findings show a masked snippet only.
 * Git is invoked with execFileSync argument arrays, never shell strings
 * (same rule as packages/git, ADR-0007). Exit codes: 0 clean, 1 findings,
 * 2 usage or environment errors.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import fg from 'fast-glob';

import { DEFAULT_LOC_CONFIG, matchesAnyGlob } from './effective-loc/src/config.js';

export interface SecretFinding {
  file: string;
  line: number;
  pattern: string;
  masked: string;
}

interface SecretPattern {
  name: string;
  regex: RegExp;
}

const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: 'private-key-block', regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { name: 'aws-access-key-id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: 'github-token', regex: /\bgh[pos]_[A-Za-z0-9]{36}\b/ },
  { name: 'slack-token', regex: /\bxox[bpars]-[0-9A-Za-z-]{5,}/ },
];

/** Heuristic: quoted literal of >= 16 chars assigned to a sensitive-looking name. */
const SENSITIVE_NAME = /(secret|token|password|api[_-]?key)/i;
const QUOTED_ASSIGNMENT = /([A-Za-z_$][\w.$-]*)\s*[:=]\s*(["'`])([^"'`\r\n]{16,})\2/g;
const PLACEHOLDER_MARKERS = ['<', 'example', 'changeme', 'xxx', 'todo', '${', 'process.env'];

function isPlaceholder(value: string): boolean {
  if (/\s/.test(value)) return true; // real secrets do not contain whitespace
  const lower = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker));
}

/** First 4 characters only; the secret value itself is never emitted. */
function mask(value: string): string {
  return `${value.slice(0, 4)}***(${value.length} chars)`;
}

export function scanLine(text: string): Array<{ pattern: string; masked: string }> {
  const hits: Array<{ pattern: string; masked: string }> = [];
  for (const pattern of SECRET_PATTERNS) {
    const match = pattern.regex.exec(text);
    if (match?.[0] !== undefined) hits.push({ pattern: pattern.name, masked: mask(match[0]) });
  }
  QUOTED_ASSIGNMENT.lastIndex = 0;
  let assignment: RegExpExecArray | null;
  while ((assignment = QUOTED_ASSIGNMENT.exec(text)) !== null) {
    const name = assignment[1] ?? '';
    const value = assignment[3] ?? '';
    if (SENSITIVE_NAME.test(name) && !isPlaceholder(value)) {
      hits.push({ pattern: 'suspicious-credential-assignment', masked: mask(value) });
    }
  }
  return hits;
}

const IGNORE_GLOBS: readonly string[] = [
  ...DEFAULT_LOC_CONFIG.ignoreGlobs,
  '**/.git/**',
  'pnpm-lock.yaml',
];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Narrows the `stderr` captured on an execFileSync error without stringifying unknowns. */
function stderrOf(error: unknown): string {
  if (error === null || typeof error !== 'object' || !('stderr' in error)) return '';
  const { stderr } = error;
  if (typeof stderr === 'string') return stderr;
  if (Buffer.isBuffer(stderr)) return stderr.toString('utf8');
  return '';
}

function runGitCachedDiff(cwd: string): string {
  try {
    return execFileSync(
      'git',
      ['diff', '--cached', '--unified=0', '--no-color', '--no-ext-diff'],
      // stdio: keep git's stderr out of our output; it is summarized below.
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    const firstLine = stderrOf(error).split('\n', 1)[0] ?? '';
    throw new Error(
      `git diff --cached failed — is this a git repository?${firstLine === '' ? '' : ` (${firstLine})`}`,
    );
  }
}

/** `+++ b/<path>` header of a unified diff; `undefined` for deleted files. */
function parseDiffTarget(headerLine: string): string | undefined {
  const target = headerLine.slice(4).trim();
  return target === '/dev/null' ? undefined : target.replace(/^b\//, '');
}

/** Starting new-file line number of a `@@ -a,b +c,d @@` hunk header. */
function parseHunkStart(hunkLine: string): number {
  const match = /\+(\d+)/.exec(hunkLine);
  return match?.[1] === undefined ? 1 : Number(match[1]);
}

interface AddedLine {
  file: string;
  line: number;
  text: string;
}

/** Added lines of the staged unified diff, with their new-file line numbers. */
function parseAddedLines(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let file: string | undefined;
  let lineNumber = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      file = parseDiffTarget(raw);
    } else if (raw.startsWith('@@')) {
      lineNumber = parseHunkStart(raw);
    } else if (raw.startsWith('+') && !raw.startsWith('+++')) {
      if (file !== undefined) added.push({ file, line: lineNumber, text: raw.slice(1) });
      lineNumber += 1;
    } else if (raw.startsWith(' ')) {
      lineNumber += 1;
    }
  }
  return added;
}

export function scanStagedDiff(cwd: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const added of parseAddedLines(runGitCachedDiff(cwd))) {
    if (matchesAnyGlob(added.file, IGNORE_GLOBS)) continue;
    for (const hit of scanLine(added.text)) {
      findings.push({ file: added.file, line: added.line, ...hit });
    }
  }
  return findings;
}

function scanFileLines(file: string, text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const hit of scanLine(lines[index] ?? '')) {
      findings.push({ file, line: index + 1, ...hit });
    }
  }
  return findings;
}

export async function scanRepository(
  cwd: string,
): Promise<{ findings: SecretFinding[]; scannedFiles: number }> {
  const files = await fg(['**/*'], {
    cwd,
    dot: true,
    onlyFiles: true,
    ignore: [...IGNORE_GLOBS],
  });
  files.sort();
  const findings: SecretFinding[] = [];
  let scannedFiles = 0;
  for (const file of files) {
    const buffer = readFileSync(path.join(cwd, file));
    if (buffer.length > MAX_FILE_BYTES || buffer.includes(0)) continue; // binary or oversized
    scannedFiles += 1;
    findings.push(...scanFileLines(file, buffer.toString('utf8')));
  }
  return { findings, scannedFiles };
}

export async function run(
  argv: readonly string[] = process.argv.slice(2),
  cwd: string = process.cwd(),
): Promise<number> {
  const staged = argv.includes('--staged');
  const rest = argv.filter((arg) => arg !== '--staged');
  // lint-staged appends the staged file list to every command it runs. In --staged mode the
  // diff already defines the scope, so those paths are redundant rather than erroneous —
  // rejecting them made the pre-commit hook fail on every commit. Flags are still validated.
  const unknown = rest.filter((arg) => arg.startsWith('-') || !staged);
  if (unknown.length > 0) {
    process.stderr.write(
      `secret-scan: unknown argument(s): ${unknown.join(' ')}\nusage: quality:secrets [--staged]\n`,
    );
    return 2;
  }

  let findings: SecretFinding[];
  let scope: string;
  try {
    if (staged) {
      findings = scanStagedDiff(cwd);
      scope = 'staged changes';
    } else {
      const result = await scanRepository(cwd);
      findings = result.findings;
      scope = `${result.scannedFiles} file(s)`;
    }
  } catch (error) {
    process.stderr.write(
      `secret-scan: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  for (const finding of findings) {
    process.stdout.write(
      `${finding.file}:${finding.line}  ${finding.pattern}  ${finding.masked}\n`,
    );
  }
  process.stdout.write(
    findings.length > 0
      ? `secret-scan: ${findings.length} potential secret(s) found in ${scope}\n`
      : `secret-scan: clean (${scope} scanned)\n`,
  );
  return findings.length > 0 ? 1 : 0;
}

// Direct-invocation guard that works under both CJS and ESM module
// interpretation (no `import.meta`, no top-level await).
const invokedScript = process.argv[1];
const isDirectRun =
  invokedScript !== undefined &&
  /\/quality\/secret-scan\.(?:ts|js|mts|mjs)$/.test(
    path.resolve(invokedScript).replace(/\\/g, '/'),
  );
if (isDirectRun) {
  void run().then((code) => {
    process.exitCode = code;
  });
}
