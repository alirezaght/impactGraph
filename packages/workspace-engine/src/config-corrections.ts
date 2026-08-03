import { failWith } from './failure.js';

import type { RepositoryGlobMatcher } from './config-path-matching.js';
import type { Failable } from './failure.js';
import type {
  ArchitectureConfigDto,
  ComponentCorrectionDto,
  ConfigOperationDto,
  ConfigSourceDto,
} from '@impactgraph/contracts';

// PRD §16 human corrections as document builders on architecture.yml. Every builder validates
// its preconditions and returns the next document; writing, auditing, and the mode gate belong
// to the shared §Z7 applier. Each persisted record carries `source` so the read-time overlay can
// tell a human-confirmed correction (§Z5 level 1) from an agent-approved one (level 2).

type Architecture = ArchitectureConfigDto;
type Component = NonNullable<Architecture['components']>[number];

export interface CorrectionContext {
  readonly now: string;
  readonly source: ConfigSourceDto;
  /** §Z13: lets a builder reject a glob that names nothing rather than persist a no-op. */
  readonly matchesRepositoryPath: RepositoryGlobMatcher;
}

const rename = (
  operation: Extract<ComponentCorrectionDto, { kind: 'rename-component' }>,
  architecture: Architecture,
  context: CorrectionContext,
): Failable<Architecture> => {
  if (operation.from === operation.to) {
    return failWith('configurationError', 'rename-component: `from` and `to` are identical');
  }
  const current = architecture.renames ?? [];
  if (current.some((entry) => entry.from === operation.from)) {
    return failWith('configurationError', `component '${operation.from}' is already renamed`);
  }
  return {
    ok: true,
    value: {
      ...architecture,
      renames: [
        ...current,
        {
          from: operation.from,
          to: operation.to,
          reason: operation.reason,
          confirmedAt: context.now,
          source: context.source,
        },
      ],
    },
  };
};

/** Replace the assignment for an exact path, or append one — never a second entry per path. */
const upsertComponent = (
  architecture: Architecture,
  path: string,
  update: (existing: Component | undefined) => Failable<Component>,
): Failable<Architecture> => {
  const current = architecture.components ?? [];
  const existing = current.find((entry) => entry.path === path);
  const next = update(existing);
  if (!next.ok) {
    return next;
  }
  return {
    ok: true,
    value: {
      ...architecture,
      components:
        existing === undefined
          ? [...current, next.value]
          : current.map((entry) => (entry.path === path ? next.value : entry)),
    },
  };
};

const assignContext = (
  operation: Extract<ComponentCorrectionDto, { kind: 'assign-context' }>,
  architecture: Architecture,
  context: CorrectionContext,
): Failable<Architecture> =>
  upsertComponent(architecture, operation.path, (existing) => {
    if (existing?.context === operation.context) {
      return failWith(
        'configurationError',
        `'${operation.path}' is already assigned to context '${operation.context}'`,
      );
    }
    return {
      ok: true,
      value: {
        ...existing,
        path: operation.path,
        context: operation.context,
        source: context.source,
      },
    };
  });

const setRole = (
  operation: Extract<ComponentCorrectionDto, { kind: 'set-component-role' }>,
  architecture: Architecture,
  context: CorrectionContext,
): Failable<Architecture> =>
  upsertComponent(architecture, operation.path, (existing) => {
    if (existing?.role === operation.role) {
      return failWith(
        'configurationError',
        `'${operation.path}' already has role '${operation.role}'`,
      );
    }
    return {
      ok: true,
      value: { ...existing, path: operation.path, role: operation.role, source: context.source },
    };
  });

const mark = (
  operation: Extract<ComponentCorrectionDto, { kind: 'mark-component' }>,
  architecture: Architecture,
  context: CorrectionContext,
): Failable<Architecture> =>
  upsertComponent(architecture, operation.path, (existing) => {
    const markers = existing?.markers ?? [];
    if (markers.includes(operation.marker)) {
      return failWith(
        'configurationError',
        `'${operation.path}' is already marked '${operation.marker}'`,
      );
    }
    return {
      ok: true,
      value: {
        ...existing,
        path: operation.path,
        markers: [...markers, operation.marker],
        source: context.source,
      },
    };
  });

/**
 * §16 "add ownership". Ownership is a human assertion about real code, so a glob that names
 * nothing is a §Z13 validation error rather than a silent no-op that rots in the document. The
 * value is taken verbatim from the operation — nothing here reads git history or infers an owner.
 */
const setOwner = (
  operation: Extract<ComponentCorrectionDto, { kind: 'set-component-owner' }>,
  architecture: Architecture,
  context: CorrectionContext,
): Failable<Architecture> => {
  const matched = context.matchesRepositoryPath(operation.component);
  if (matched === undefined) {
    return failWith(
      'configurationError',
      `set-component-owner: the repository could not be read to check '${operation.component}'`,
    );
  }
  if (!matched) {
    return failWith(
      'configurationError',
      `set-component-owner: '${operation.component}' matches no file in the repository — ownership must name code that exists`,
    );
  }
  return upsertComponent(architecture, operation.component, (existing) => {
    if (existing?.owner === operation.owner) {
      return failWith(
        'configurationError',
        `'${operation.component}' is already owned by '${operation.owner}'`,
      );
    }
    return {
      ok: true,
      value: {
        ...existing,
        path: operation.component,
        owner: operation.owner,
        source: context.source,
      },
    };
  });
};

const setRelationship = (
  operation: Extract<ComponentCorrectionDto, { kind: 'set-relationship-confirmation' }>,
  architecture: Architecture,
  context: CorrectionContext,
): Failable<Architecture> => {
  const current = architecture.relationships ?? [];
  const existing = current.find((entry) => entry.edgeId === operation.edgeId);
  if (existing?.confirmed === operation.confirmed) {
    return failWith(
      'configurationError',
      `relationship '${operation.edgeId}' is already recorded as ${operation.confirmed ? 'confirmed' : 'rejected'}`,
    );
  }
  const record = {
    edgeId: operation.edgeId,
    confirmed: operation.confirmed,
    reason: operation.reason,
    confirmedAt: context.now,
    source: context.source,
  };
  return {
    ok: true,
    value: {
      ...architecture,
      relationships:
        existing === undefined
          ? [...current, record]
          : current.map((entry) => (entry.edgeId === operation.edgeId ? record : entry)),
    },
  };
};

/** §16 correction → next architecture.yml document. One entry point per correction kind. */
export const nextArchitectureWithCorrection = (
  operation: ComponentCorrectionDto,
  architecture: Architecture,
  context: CorrectionContext,
): Failable<Architecture> => {
  switch (operation.kind) {
    case 'rename-component':
      return rename(operation, architecture, context);
    case 'assign-context':
      return assignContext(operation, architecture, context);
    case 'set-component-role':
      return setRole(operation, architecture, context);
    case 'mark-component':
      return mark(operation, architecture, context);
    case 'set-component-owner':
      return setOwner(operation, architecture, context);
    case 'set-relationship-confirmation':
      return setRelationship(operation, architecture, context);
  }
};

const CORRECTION_KINDS: ReadonlySet<string> = new Set([
  'rename-component',
  'assign-context',
  'set-component-role',
  'mark-component',
  'set-component-owner',
  'set-relationship-confirmation',
]);

export const isComponentCorrection = (
  operation: ConfigOperationDto,
): operation is ComponentCorrectionDto => CORRECTION_KINDS.has(operation.kind);
