import { applyConfigOperation, classifyOperation } from './config-operations.js';
import { failWith } from './failure.js';

import type { ConfigActor } from './config-operations.js';
import type { Failable } from './failure.js';
import type { ConfigInstructionTranslator } from '@impactgraph/ai-inference';
import type { ConfigOperationDto } from '@impactgraph/contracts';

// Story 14.7 — §Z15: translated operations flow through the SAME governed applier as every
// other change (classify → mode gate → validate → atomic write → audit). Partial application
// is honest: each operation succeeds or fails on its own and the caller sees both.

export interface InstructionRequest {
  readonly rootDir: string;
  readonly instruction: string;
  readonly translator: ConfigInstructionTranslator;
  readonly actor: ConfigActor;
  readonly approvedByUser?: boolean | undefined;
}

export interface InstructionOperationResult {
  readonly operation: ConfigOperationDto;
  readonly classification: 'safe' | 'material';
  readonly status: 'applied' | 'rejected';
  readonly detail: string;
}

export interface InstructionOutcome {
  readonly results: readonly InstructionOperationResult[];
  /** What the vocabulary could not express — surfaced, never silently dropped. */
  readonly unsupported?: string | undefined;
}

export const applyInstruction = async (
  request: InstructionRequest,
): Promise<Failable<InstructionOutcome>> => {
  if (request.instruction.trim().length === 0) {
    return failWith('configurationError', 'empty instruction');
  }
  const translated = await request.translator.translate(request.instruction);
  if (!translated.ok) {
    return failWith(
      translated.error.code === 'not-configured' ? 'configurationError' : 'providerFailure',
      `instruction translation unavailable: ${translated.error.message}`,
    );
  }
  const results: InstructionOperationResult[] = [];
  for (const operation of translated.value.operations) {
    const applied = applyConfigOperation({
      rootDir: request.rootDir,
      operation,
      actor: request.actor,
      approvedByUser: request.approvedByUser,
    });
    results.push({
      operation,
      classification: classifyOperation(operation),
      status: applied.ok ? 'applied' : 'rejected',
      detail: applied.ok ? `audited as ${applied.value.rollbackId}` : applied.error.message,
    });
  }
  return {
    ok: true,
    value: {
      results,
      ...(translated.value.unsupported === undefined
        ? {}
        : { unsupported: translated.value.unsupported }),
    },
  };
};
