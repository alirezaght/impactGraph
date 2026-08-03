import {
  applyConfigOperation,
  confirmConfigurationValue,
  refreshConfiguration,
  removeStaleConfiguration,
} from '@impactgraph/workspace-engine';

import type { ToolHandler } from './handler-types.js';
import type { ConfigActor } from '@impactgraph/workspace-engine';

// §Z5/§Z10 configuration-maintenance handlers. Every write goes through the governed
// operation path (classify → mode gate → §Z13 validation → atomic write → §Z12 audit).
// `confirm_configuration_value` and `remove_stale_configuration` only run once the contract
// has already required the caller's confirmedByUser assertion (§35).

const MCP_ACTOR: ConfigActor = { kind: 'agent', agentId: 'mcp-client' };

const stripDrift = (
  items: readonly { kind: string; subject: string; detail: string }[],
): { kind: string; subject: string; detail: string }[] =>
  items.map((item) => ({ kind: item.kind, subject: item.subject, detail: item.detail }));

const refresh: ToolHandler<'refresh_configuration'> = async (rootDir) => {
  const refreshed = await refreshConfiguration(rootDir, MCP_ACTOR);
  if (!refreshed.ok) {
    return refreshed;
  }
  return {
    ok: true,
    value: {
      applied: stripDrift(refreshed.value.applied),
      needsReview: stripDrift(refreshed.value.needsReview),
      changedFiles: [...refreshed.value.changedFiles],
      ...(refreshed.value.previousChangeAt === undefined
        ? {}
        : { previousChangeAt: refreshed.value.previousChangeAt }),
      changeCountBefore: refreshed.value.changeCountBefore,
    },
  };
};

const confirmValue: ToolHandler<'confirm_configuration_value'> = (rootDir, input) => {
  // confirmedByUser: true is guaranteed by the contract (§35).
  const confirmed = confirmConfigurationValue(rootDir, MCP_ACTOR, {
    subjectKind: input.subjectKind,
    subject: input.subject,
    reason: input.reason,
  });
  return Promise.resolve(confirmed.ok ? { ok: true, value: { ...confirmed.value } } : confirmed);
};

const removeStale: ToolHandler<'remove_stale_configuration'> = async (rootDir, input) => {
  // confirmedByUser: true is guaranteed by the contract (§35).
  const outcome = await removeStaleConfiguration(rootDir, MCP_ACTOR, input.subjects);
  if (!outcome.ok) {
    return outcome;
  }
  return {
    ok: true,
    value: {
      removed: outcome.value.removed.map((entry) => ({ ...entry })),
      skipped: outcome.value.skipped.map((entry) => ({ ...entry })),
    },
  };
};

/**
 * §16 human correction. `confirmedByUser: true` is guaranteed by the contract (§35), so the
 * operation is applied as an explicitly approved change and the persisted record carries the
 * §Z5 `human-confirmed` level. The graph is untouched — corrections are overlaid at read time.
 */
const applyCorrection: ToolHandler<'apply_component_correction'> = (rootDir, input) => {
  const applied = applyConfigOperation({
    rootDir,
    operation: input.correction,
    actor: MCP_ACTOR,
    approvedByUser: true,
  });
  if (!applied.ok) {
    return Promise.resolve(applied);
  }
  return Promise.resolve({
    ok: true,
    value: {
      rollbackId: applied.value.rollbackId,
      file: 'architecture.yml',
      kind: input.correction.kind,
      source: 'human-confirmed',
    },
  });
};

export const CONFIG_MAINTENANCE_HANDLERS = {
  refresh_configuration: refresh,
  confirm_configuration_value: confirmValue,
  apply_component_correction: applyCorrection,
  remove_stale_configuration: removeStale,
} as const;
