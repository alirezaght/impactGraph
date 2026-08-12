import { looksLikeGuardPath } from '../types.js';

import type { ConstraintRecognizer, ExtractedConstraint, GuardFile } from '../types.js';

/**
 * CI workflows, read for one fact only: which guards must pass, and over what.
 *
 * This recognizer does not try to understand what a step does — that is the guard-script
 * recognizer's job. It answers the prior question the trials showed nobody was asking: *is this
 * script actually enforced?* A guard nobody runs is documentation; a guard wired into a required
 * workflow can stop a merge, and only the second deserves `blocking`.
 */

const WORKFLOW_PATH =
  /(^|\/)\.(github\/workflows|gitlab-ci|circleci)\/?[^/]*\.(ya?ml)$|\.gitlab-ci\.yml$/;

/** Commands that invoke a repository guard rather than doing ordinary build work. */
const GUARD_COMMAND =
  /^\s*(?:-\s*)?(?:run:\s*)?(?:.*?\s)?((?:python3?|node|bash|sh|npx|pnpm|npm run|yarn)\s+[^\n|&;]*(?:ci\/scripts\/|scripts\/quality\/|check[-_][\w-]+|verify[-_][\w-]+|validate[-_][\w-]+|quality:\w+|lint)[^\n|&;]*)/;

const commandsIn = (content: string): readonly { command: string; line: number }[] => {
  const found: { command: string; line: number }[] = [];
  content.split('\n').forEach((line, index) => {
    const match = GUARD_COMMAND.exec(line);
    const command = match?.[1]?.trim();
    if (command !== undefined && command.length > 0) {
      found.push({ command, line: index + 1 });
    }
  });
  return found;
};

/** The script path a command invokes, when it names one — that is what the constraint points at. */
const invokedScript = (command: string): string | undefined =>
  /(\S*(?:ci\/scripts|scripts\/quality)\/\S+)/.exec(command)?.[1];

export const ciWorkflowRecognizer: ConstraintRecognizer = {
  id: 'ci-workflow',
  appliesTo: (path) => WORKFLOW_PATH.test(path),
  recognize: (file: GuardFile): readonly ExtractedConstraint[] => {
    const seen = new Set<string>();
    const constraints: ExtractedConstraint[] = [];
    for (const { command, line } of commandsIn(file.content)) {
      const script = invokedScript(command);
      const key = script ?? command;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      constraints.push({
        name: `CI requires: ${key}`,
        kind: 'must-pass-check',
        severity: 'blocking',
        extraction: 'recognized',
        scope: { pathGlobs: ['**'] },
        rule: {
          relation: 'MUST_PASS',
          subjectPattern: command,
          statement: `${key} runs in CI and must pass before this repository accepts a change`,
        },
        exemptions: [],
        sourceLine: line,
        recognizer: 'ci-workflow',
      });
    }
    return constraints;
  },
};

/** Guards that exist on disk but no workflow invokes. Enforcement is a repository-level fact. */
export const unenforcedGuards = (
  guardPaths: readonly string[],
  enforcedSubjects: readonly string[],
): readonly string[] =>
  guardPaths.filter(
    (path) =>
      looksLikeGuardPath(path) && !enforcedSubjects.some((subject) => subject.includes(path)),
  );
