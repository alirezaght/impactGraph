import { join } from 'node:path';

import { cliAnalyzeOutputSchema, cliReviewOutputSchema } from '@impactgraph/contracts';

import { startEngineJob } from '../../engine/engine-client.js';

import { requireExtension } from './support.js';
import { SPEC_FILE_NAME, SPEC_TEXT } from './workspace-setup.js';

import type { EngineJobHandle } from '../../engine/engine-client.js';
import type { EngineJobSpec } from '../../engine/protocol.js';
import type { CliAnalyzeOutput, CliReviewOutput } from '@impactgraph/contracts';

// The Impact and Review trees are fed by the workflow commands, which hand the provider a
// contract-validated engine document. Command handlers do not return it, so the suites obtain
// the same document over the same worker boundary the shell uses — via engine-client, with the
// same schema validation. This also exercises the child-process path outside the host (§32/§33).

export const engineEntryPath = (): string =>
  join(requireExtension().extensionPath, 'dist', 'engine-worker.cjs');

export const startJob = (request: EngineJobSpec): EngineJobHandle =>
  startEngineJob(engineEntryPath(), request);

const runToCompletion = async (request: EngineJobSpec): Promise<unknown> => {
  const outcome = await startJob(request).outcome;
  if (outcome.kind !== 'done') {
    const detail = outcome.kind === 'failed' ? `: ${outcome.error.message}` : '';
    throw new Error(`engine job '${request.op}' ended as '${outcome.kind}'${detail}`);
  }
  return outcome.value;
};

export const analyzeViaEngine = async (rootDir: string): Promise<CliAnalyzeOutput> =>
  cliAnalyzeOutputSchema.parse(
    await runToCompletion({
      op: 'analyze',
      rootDir,
      specName: SPEC_FILE_NAME,
      rawText: SPEC_TEXT,
    }),
  );

export const reviewViaEngine = async (rootDir: string): Promise<CliReviewOutput> =>
  cliReviewOutputSchema.parse(
    await runToCompletion({ op: 'review', rootDir, target: 'working-tree' }),
  );
