import { stableContentId } from '@impactgraph/domain';

import { buildCoChangeIndex } from '../history/co-change-index.js';

import { compareFootprints, interpretationFootprint, nodeNames } from './interpretation-compare.js';
import { optionImplications } from './option-implications.js';
import { deriveProposedRelationships } from './proposed-relationships.js';

import type {
  InterpretationDraft,
  SpecificationInterpretationPort,
} from './interpretation-port.js';
import type { CoChangeIndex } from '../history/co-change-index.js';
import type {
  ArchitecturalOption,
  KnowledgeGraph,
  NodeId,
  OpenQuestion,
  ProposedRelationship,
  ProposedStructure,
  Requirement,
  Specification,
} from '@impactgraph/domain';

// Story 15.1–15.3 — the §C4 clarification pipeline. Philosophy (§C3, verbatim): "Infer
// everything supported by evidence. Ask only when ambiguity materially changes the
// architecture." A question exists ONLY because two interpretations produce different impact
// footprints; generic "information missing" questions are structurally impossible here.

export interface ClarifySpecificationRequest {
  readonly specification: Specification;
  readonly graph: KnowledgeGraph;
  readonly interpreter: SpecificationInterpretationPort;
  readonly aliases?: Readonly<Record<string, string>>;
  /** Files-per-recent-commit — questions cite repository history where it exists (§C7). */
  readonly history?: readonly (readonly string[])[];
  /** Bounds provider calls: one per requirement, at most this many requirements. */
  readonly maxRequirements?: number;
}

export interface ClarifyOutcome {
  readonly openQuestions: readonly OpenQuestion[];
  /** §C8 — each material interpretation as a selectable option, bound into the analysis. */
  readonly options: readonly ArchitecturalOption[];
  /**
   * §18.4/§26 — the relationships the options would CREATE, kept strictly apart from the
   * deterministic graph. Empty when the readings converge, because converging readings produce
   * no options at all (§C3).
   */
  readonly proposedStructure: ProposedStructure;
  readonly warnings: readonly string[];
}

interface QuestionInput {
  readonly requirement: Requirement;
  readonly graph: KnowledgeGraph;
  readonly a: InterpretationDraft;
  readonly b: InterpretationDraft;
  readonly divergentNodeIds: readonly string[];
  readonly severity: OpenQuestion['severity'];
  readonly coChange: CoChangeIndex;
}

/** §C7: cite actual repository history for the diverging components, when it exists. */
const historyCitation = (
  graph: KnowledgeGraph,
  divergentNodeIds: readonly string[],
  coChange: CoChangeIndex,
): string => {
  if (coChange.totalCommits === 0) {
    return '';
  }
  for (const id of divergentNodeIds) {
    const path = graph.nodes.get(id as NodeId)?.path;
    if (path === undefined) {
      continue;
    }
    const touches = coChange.pathCount(path);
    if (touches > 0) {
      return ` History: '${path}' changed in ${String(touches)} of the last ${String(coChange.totalCommits)} commits.`;
    }
  }
  return '';
};

/** §C7 phrasing: the question cites the actual repository components that diverge. */
const questionFor = ({
  requirement,
  graph,
  a,
  b,
  divergentNodeIds,
  severity,
  coChange,
}: QuestionInput): OpenQuestion => {
  const names = nodeNames(graph, divergentNodeIds.slice(0, 4));
  const text = `'${a.title}' or '${b.title}'? The readings lead to different changes in ${names.join(', ')} — ${a.assumption} Or: ${b.assumption}`;
  return {
    id: stableContentId('question', text),
    question: text,
    reason: `competing interpretations produce materially different impact footprints (diverging on ${String(divergentNodeIds.length)} component(s))${historyCitation(graph, divergentNodeIds, coChange)}`,
    affectedRequirementIds: [requirement.id],
    severity,
    status: 'open',
  };
};

/** §C8: a material interpretation, offered as a selectable option instead of an essay answer. */
const optionFor = (
  requirement: Requirement,
  graph: KnowledgeGraph,
  draft: InterpretationDraft,
  context: { footprint: ReadonlySet<string>; questionId: string },
): ArchitecturalOption => {
  const affectedNodeIds = [...context.footprint].sort((a, b) => a.localeCompare(b));
  const names = nodeNames(graph, affectedNodeIds.slice(0, 4));
  return {
    id: stableContentId('option', `${requirement.id}:${draft.title}`),
    title: draft.title,
    description: `${draft.assumption} Affects ${names.join(', ')}. (AI-assisted interpretation — selecting it answers the linked question.)`,
    affectedNodeIds,
    linkedQuestionId: context.questionId,
    implications: optionImplications(graph, context.footprint),
  };
};

interface RequirementClarification {
  questions: OpenQuestion[];
  options: ArchitecturalOption[];
  warning?: string;
}

const clarifyRequirement = async (
  request: ClarifySpecificationRequest,
  requirement: Requirement,
  coChange: CoChangeIndex,
): Promise<RequirementClarification> => {
  const interpreted = await request.interpreter.interpret(requirement, request.specification.title);
  if (!interpreted.ok) {
    return {
      questions: [],
      options: [],
      warning: `interpretation unavailable for ${requirement.id}: ${interpreted.error.code}`,
    };
  }
  const drafts = interpreted.value;
  if (drafts.length < 2) {
    return { questions: [], options: [] }; // one plausible reading — nothing to ask (§C3)
  }
  const aliases = request.aliases ?? {};
  const footprints = drafts.map((draft) =>
    interpretationFootprint(request.graph, draft.concepts, aliases),
  );
  const primary = footprints[0];
  const primaryDraft = drafts[0];
  if (primary === undefined || primaryDraft === undefined) {
    return { questions: [], options: [] };
  }
  const outcome: RequirementClarification = { questions: [], options: [] };
  for (let index = 1; index < drafts.length; index += 1) {
    const other = footprints[index];
    const otherDraft = drafts[index];
    if (other !== undefined && otherDraft !== undefined) {
      compareDrafts({
        request,
        requirement,
        coChange,
        outcome,
        primary: { draft: primaryDraft, footprint: primary },
        other: { draft: otherDraft, footprint: other },
      });
    }
  }
  return outcome;
};

interface DraftComparison {
  readonly request: ClarifySpecificationRequest;
  readonly requirement: Requirement;
  readonly coChange: CoChangeIndex;
  readonly outcome: RequirementClarification;
  readonly primary: { draft: InterpretationDraft; footprint: ReadonlySet<string> };
  readonly other: { draft: InterpretationDraft; footprint: ReadonlySet<string> };
}

const compareDrafts = ({
  request,
  requirement,
  coChange,
  outcome,
  primary,
  other,
}: DraftComparison): void => {
  const divergence = compareFootprints(request.graph, primary.footprint, other.footprint);
  if (divergence.severity === undefined) {
    return;
  }
  const question = questionFor({
    requirement,
    graph: request.graph,
    a: primary.draft,
    b: other.draft,
    divergentNodeIds: divergence.divergentNodeIds,
    severity: divergence.severity,
    coChange,
  });
  outcome.questions.push(question);
  if (outcome.options.length === 0) {
    outcome.options.push(
      optionFor(requirement, request.graph, primary.draft, {
        footprint: primary.footprint,
        questionId: question.id,
      }),
    );
  }
  outcome.options.push(
    optionFor(requirement, request.graph, other.draft, {
      footprint: other.footprint,
      questionId: question.id,
    }),
  );
};

/**
 * §18.4: what each option would ADD to the architecture. Runs once over the settled option set
 * so a proposal always cites an option the analysis actually carries. v1 derives relationships
 * only — never nodes (the reasoning lives in proposed-relationships.ts).
 */
const proposedStructureFor = (
  graph: KnowledgeGraph,
  options: readonly ArchitecturalOption[],
  coChange: CoChangeIndex,
  warnings: string[],
): ProposedStructure => {
  const relationships: ProposedRelationship[] = [];
  for (const option of options) {
    const derived = deriveProposedRelationships(graph, option, coChange);
    if (derived.cutoff) {
      warnings.push(
        `proposed-relationship limit reached for option '${option.title}' — further implied relationships omitted`,
      );
    }
    relationships.push(...derived.relationships);
  }
  return { nodes: [], relationships };
};

const SEVERITY_ORDER: Record<OpenQuestion['severity'], number> = {
  blocking: 0,
  important: 1,
  minor: 2,
};

export const clarifySpecification = async (
  request: ClarifySpecificationRequest,
): Promise<ClarifyOutcome> => {
  const known = new Set(
    request.specification.openQuestions.map((question) =>
      stableContentId('question', question.question),
    ),
  );
  const questions: OpenQuestion[] = [];
  const options: ArchitecturalOption[] = [];
  const warnings: string[] = [];
  const coChange = buildCoChangeIndex(request.history ?? []);
  const requirements = request.specification.requirements.slice(0, request.maxRequirements ?? 10);
  for (const requirement of requirements) {
    const outcome = await clarifyRequirement(request, requirement, coChange);
    if (outcome.warning !== undefined) {
      warnings.push(outcome.warning);
      break; // provider failed — degrade to deterministic behavior, no partial spam (§8)
    }
    for (const question of outcome.questions) {
      if (!known.has(question.id)) {
        known.add(question.id);
        questions.push(question);
      }
    }
    for (const option of outcome.options) {
      if (!options.some((existing) => existing.id === option.id)) {
        options.push(option);
      }
    }
  }
  // §C5 cost-aware ordering: blocking first, then important, then minor.
  questions.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id),
  );
  return {
    openQuestions: questions,
    options,
    proposedStructure: proposedStructureFor(request.graph, options, coChange, warnings),
    warnings,
  };
};
