// Story 13.2 — secret redaction for every outbound payload and every log line (PRD §35).
// Pattern-based and deliberately over-eager: a false positive costs a little prompt quality;
// a false negative leaks a credential.

export interface RedactionResult {
  readonly text: string;
  readonly redactionCount: number;
  /** Which pattern names fired — safe to log (never the matched values). */
  readonly kinds: readonly string[];
}

interface SecretPattern {
  readonly name: string;
  readonly pattern: RegExp;
}

/** Ordered pattern library; multiline blocks first so key material never partially survives. */
const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    name: 'private-key-block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { name: 'aws-access-key', pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'openai-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g },
  {
    name: 'connection-string',
    pattern: /\b[a-z][a-z0-9+]*:\/\/[^\s:@/]+:[^\s@/]+@[^\s"']+/gi,
  },
  {
    name: 'assigned-secret',
    // password/secret/token/api_key = "value" (env files, yaml, json, code)
    pattern:
      /\b(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b(\s*[:=]\s*)["']?[^\s"',;]{6,}["']?/gi,
  },
];

/** Replace every recognized secret with a stable placeholder naming the pattern. */
export const redactSecrets = (text: string): RedactionResult => {
  let redacted = text;
  let count = 0;
  const kinds = new Set<string>();
  for (const { name, pattern } of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match: string, ...groups: unknown[]) => {
      count += 1;
      kinds.add(name);
      if (name === 'assigned-secret') {
        // keep the key name and assignment so context survives; drop only the value
        const key = groups[0] as string;
        const assignment = groups[1] as string;
        return `${key}${assignment}[REDACTED:${name}]`;
      }
      return `[REDACTED:${name}]`;
    });
  }
  return { text: redacted, redactionCount: count, kinds: [...kinds] };
};

/** Exact filenames whose content never leaves the machine. */
const SECRET_FILENAMES = new Set([
  '.env',
  'credentials',
  'credentials.json',
  'service-account.json',
]);

/**
 * Suffixes whose content never leaves the machine. `.tfvars` is here rather than in the
 * scanner's ignore list on purpose: WHICH variables a file configures is an architectural fact
 * worth indexing (it produces §12 CONFIGURES edges), while the assigned VALUES are routinely
 * credentials. Indexing reads the names; this gate stops the bytes reaching a provider.
 */
const SECRET_SUFFIXES = ['.tfvars', '.tfvars.json', '.pem', '.key', '.p12', '.pfx'];

/** Files whose CONTENT is never included in prompts or logs, regardless of mode (PRD §35). */
export const isSecretBearingPath = (path: string): boolean => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return (
    SECRET_FILENAMES.has(base) ||
    base.startsWith('.env.') ||
    SECRET_SUFFIXES.some((suffix) => base.endsWith(suffix))
  );
};
