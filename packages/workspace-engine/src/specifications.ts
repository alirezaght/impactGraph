import { basename } from 'node:path';

import {
  assignEvidenceProvenance,
  buildImpactModel,
  clarifySpecification,
  extractSpecification,
  refineWithClassifier,
} from '@impactgraph/application';
import { applyKnownClarifications, createNextSpecificationVersion } from '@impactgraph/domain';
import { createGitCliAdapter } from '@impactgraph/git';
import {
  artifactsPath,
  createClarificationArtifactStore,
  createImpactAnalysisArtifactStore,
  createSpecificationArtifactStore,
  readAliasesConfig,
} from '@impactgraph/persistence';

import { failWith } from './failure.js';
import { loadCurrentGraph, withIndexStore } from './graphs.js';

import type { Failable } from './failure.js';
import type {
  ImpactClassificationPort,
  IndexStorePort,
  SpecificationExtractionPort,
  SpecificationInterpretationPort,
} from '@impactgraph/application';
import type {
  ArchitecturalOption,
  EvidenceId,
  ImpactAnalysis,
  KnowledgeGraph,
  ProposedStructure,
  SourceRange as EvidenceSourceRange,
  Specification,
} from '@impactgraph/domain';

// The spec → analysis half of the workflow (§46), shared by `impactgraph analyze` and the
// MCP submit_specification / analyze_impact tools. Deterministic without a provider (§8).

export type ExtractionMode = 'provider' | 'deterministic-fallback' | 'unchanged';

export const specIdFor = (specName: string): string => {
  const slug = basename(specName)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-');
  return `spec-${slug}`;
};

export const titleFor = (rawText: string, specName: string): string => {
  const heading = rawText.split('\n').find((line) => line.startsWith('# '));
  return heading?.slice(2).trim() ?? basename(specName);
};

export interface SubmitSpecificationRequest {
  readonly rootDir: string;
  /** Logical name (usually the file name) — the stable specification id derives from it. */
  readonly specName: string;
  readonly rawText: string;
  readonly sourceReference?: string | undefined;
  /** Configured AI extractor (guarded, audited); absent = deterministic fallback (PRD §8). */
  readonly extractor?: SpecificationExtractionPort | undefined;
}

export interface SubmittedSpecification {
  readonly specification: Specification;
  readonly extractionMode: ExtractionMode;
}

/** Persist (or reuse) a specification version with extracted requirements (PRD §11). */
export const submitSpecification = async (
  request: SubmitSpecificationRequest,
): Promise<Failable<SubmittedSpecification>> => {
  const store = createSpecificationArtifactStore(artifactsPath(request.rootDir));
  const specificationId = specIdFor(request.specName);
  const latest = await store.getLatest(specificationId);
  if (!latest.ok) {
    return failWith('configurationError', latest.error.message);
  }
  if (latest.value !== undefined && latest.value.rawText === request.rawText) {
    return { ok: true, value: { specification: latest.value, extractionMode: 'unchanged' } };
  }
  const extracted = await extractSpecification(
    {
      specificationId,
      title: titleFor(request.rawText, request.specName),
      rawText: request.rawText,
      sourceType: 'markdown',
      sourceReference: request.sourceReference ?? request.specName,
      ...(latest.value === undefined ? {} : { previousVersion: latest.value }),
    },
    {
      clock: { now: () => new Date().toISOString() },
      ...(request.extractor === undefined ? {} : { extractor: request.extractor }),
    },
  );
  if (!extracted.ok) {
    return failWith('internalError', 'specification extraction failed validation');
  }
  // §C9: previously recorded clarification ADRs answer their questions up front.
  const clarifications = await createClarificationArtifactStore(
    artifactsPath(request.rootDir),
  ).listAll();
  const withKnownAnswers = clarifications.ok
    ? applyKnownClarifications(extracted.value.specification, clarifications.value).specification
    : extracted.value.specification;
  const saved = await store.saveVersion(withKnownAnswers);
  if (!saved.ok) {
    return failWith('configurationError', saved.error.message);
  }
  return {
    ok: true,
    value: {
      specification: withKnownAnswers,
      extractionMode: extracted.value.extractionMode,
    },
  };
};

export const loadSpecification = async (
  rootDir: string,
  specificationId: string,
  version?: number,
): Promise<Failable<Specification>> => {
  const store = createSpecificationArtifactStore(artifactsPath(rootDir));
  const spec =
    version === undefined
      ? await store.getLatest(specificationId)
      : await store.getVersion(specificationId, version);
  if (!spec.ok) {
    return failWith('configurationError', spec.error.message);
  }
  if (spec.value === undefined) {
    return failWith('configurationError', `specification not found: ${specificationId}`);
  }
  return { ok: true, value: spec.value };
};

export const evidenceFilesFor = async (
  store: IndexStorePort,
  evidenceIds: readonly string[],
): Promise<ReadonlyMap<string, string>> => {
  const byId = new Map<string, string>();
  const records = await store.getEvidence([...new Set(evidenceIds)] as EvidenceId[]);
  if (records.ok) {
    for (const record of records.value) {
      byId.set(
        record.id,
        record.source.kind === 'git-commit'
          ? `commit ${record.source.commitSha}`
          : record.source.filePath,
      );
    }
  }
  return byId;
};

/** Source ranges per evidence id (§40.4 range-accurate reveal); only file evidence has one. */
export const evidenceRangesFor = async (
  store: IndexStorePort,
  evidenceIds: readonly string[],
): Promise<ReadonlyMap<string, EvidenceSourceRange>> => {
  const byId = new Map<string, EvidenceSourceRange>();
  const records = await store.getEvidence([...new Set(evidenceIds)] as EvidenceId[]);
  if (!records.ok) {
    return byId;
  }
  for (const record of records.value) {
    if (record.source.kind === 'file' && record.source.range !== undefined) {
      byId.set(record.id, { ...record.source.range });
    }
  }
  return byId;
};

export interface AnalysisBundle {
  readonly analysis: ImpactAnalysis;
  readonly graph: KnowledgeGraph;
  readonly snapshotId: string;
  readonly evidenceFileById: ReadonlyMap<string, string>;
  /** 'llm' when the §43.5 re-classification pass ran; deterministic otherwise. */
  readonly classificationMode: 'llm' | 'deterministic-only';
}

export interface BuildAnalysisOptions {
  /** Configured, guarded classifier for the §43.5 second stage; absent = deterministic only. */
  readonly classifier?: ImpactClassificationPort | undefined;
  /** Configured, guarded interpreter for §C4 clarification; absent = no questions asked. */
  readonly interpreter?: SpecificationInterpretationPort | undefined;
}

/**
 * §C4 clarification: interpretations → footprint divergence → material questions. New
 * questions land as specification version N+1 (append-only), pre-answered where a recorded
 * clarification ADR already decided them (§C9).
 */
interface ClarifyInput {
  readonly rootDir: string;
  readonly specification: Specification;
  readonly graph: KnowledgeGraph;
  readonly interpreter: SpecificationInterpretationPort;
  readonly aliases: Readonly<Record<string, string>>;
  readonly history: readonly (readonly string[])[];
}

interface ClarifiedSpecification {
  readonly specification: Specification;
  readonly options: readonly ArchitecturalOption[];
  /** §18.4: what the options would ADD — carried separately from the deterministic graph. */
  readonly proposedStructure: ProposedStructure;
}

const attachClarifications = async ({
  rootDir,
  specification,
  graph,
  interpreter,
  aliases,
  history,
}: ClarifyInput): Promise<Failable<ClarifiedSpecification>> => {
  const clarified = await clarifySpecification({
    specification,
    graph,
    interpreter,
    aliases,
    history,
  });
  if (clarified.openQuestions.length === 0) {
    return {
      ok: true,
      value: {
        specification,
        options: clarified.options,
        proposedStructure: clarified.proposedStructure,
      },
    };
  }
  const nextVersion = createNextSpecificationVersion(
    specification,
    { openQuestions: [...specification.openQuestions, ...clarified.openQuestions] },
    new Date().toISOString(),
  );
  if (!nextVersion.ok) {
    return failWith('internalError', 'clarified specification failed validation');
  }
  const adrs = await createClarificationArtifactStore(artifactsPath(rootDir)).listAll();
  const withKnown = adrs.ok
    ? applyKnownClarifications(nextVersion.value, adrs.value).specification
    : nextVersion.value;
  const saved = await createSpecificationArtifactStore(artifactsPath(rootDir)).saveVersion(
    withKnown,
  );
  if (!saved.ok) {
    return failWith('configurationError', saved.error.message);
  }
  return {
    ok: true,
    value: {
      specification: withKnown,
      options: clarified.options,
      proposedStructure: clarified.proposedStructure,
    },
  };
};

/** Recent files-per-commit for §14/§C7 — best effort, empty when git is unavailable. */
const recentHistory = async (rootDir: string): Promise<readonly (readonly string[])[]> => {
  const commits = await createGitCliAdapter().readRecentCommitFiles(rootDir, 200);
  return commits.ok ? commits.value : [];
};

/** Build + persist an impact analysis: deterministic candidates first, then the optional
 *  LLM re-classification of that bounded set (§43.5). AI failure keeps the deterministic
 *  analysis fully usable (PRD §8) — the refine pass runs BEFORE the artifact is persisted. */
export const buildAnalysisForSpecification = async (
  rootDir: string,
  specification: Specification,
  options: BuildAnalysisOptions = {},
): Promise<Failable<AnalysisBundle>> =>
  withIndexStore(rootDir, async (store) => {
    const loaded = await loadCurrentGraph(store);
    if (!loaded.ok) {
      return loaded;
    }
    const aliasesConfig = readAliasesConfig(rootDir);
    if (!aliasesConfig.ok) {
      return failWith('configurationError', aliasesConfig.error.message);
    }
    const aliases = aliasesConfig.value?.aliases ?? {};
    const history = await recentHistory(rootDir);
    let effectiveSpecification = specification;
    let clarificationOptions: readonly ArchitecturalOption[] = [];
    let proposedStructure: ProposedStructure | undefined;
    if (options.interpreter !== undefined) {
      const clarified = await attachClarifications({
        rootDir,
        specification,
        graph: loaded.value.graph,
        interpreter: options.interpreter,
        aliases,
        history,
      });
      if (!clarified.ok) {
        return clarified;
      }
      effectiveSpecification = clarified.value.specification;
      clarificationOptions = clarified.value.options;
      proposedStructure = clarified.value.proposedStructure;
    }
    const analysis = buildImpactModel({
      specification: effectiveSpecification,
      graph: loaded.value.graph,
      repositorySnapshotId: loaded.value.snapshotId,
      analysisId: `analysis-${effectiveSpecification.id}-v${String(effectiveSpecification.version)}-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      aliases,
      excludedComponents: (aliasesConfig.value?.exclusions ?? []).map((entry) => entry.component),
      history,
      architecturalOptions: clarificationOptions,
      proposedStructure,
    });
    if (!analysis.ok) {
      return failWith('internalError', 'impact analysis failed validation');
    }
    return refineAndPersist({
      rootDir,
      store,
      analysis: analysis.value,
      specification: effectiveSpecification,
      graph: loaded.value.graph,
      snapshotId: loaded.value.snapshotId,
      classifier: options.classifier,
    });
  });

interface FinalizeInput {
  readonly rootDir: string;
  readonly store: IndexStorePort;
  readonly analysis: ImpactAnalysis;
  readonly specification: Specification;
  readonly graph: KnowledgeGraph;
  readonly snapshotId: string;
  readonly classifier?: ImpactClassificationPort | undefined;
}

const refineAndPersist = async (input: FinalizeInput): Promise<Failable<AnalysisBundle>> => {
  let finalAnalysis = input.analysis;
  let classificationMode: 'llm' | 'deterministic-only' = 'deterministic-only';
  if (input.classifier !== undefined) {
    const refined = await refineWithClassifier(
      input.analysis,
      input.specification,
      input.graph,
      input.classifier,
    );
    if (refined.ok) {
      finalAnalysis = refined.value.analysis;
      classificationMode = refined.value.classificationMode;
    }
  }
  // Base evidence provenance is assigned BEFORE the artifact is persisted (ADR-0017 §5), so every
  // reader of the stored analysis — list_impacts, get_impact_analysis, review, export — can tell an
  // echo of the specification from a discovery. Constraint- and runtime-derived UPGRADES cannot
  // happen here: those provenances only exist after the preflight constraint pass, which re-assigns
  // in memory (see preflight.ts) without rewriting the stored artifact.
  finalAnalysis = assignEvidenceProvenance({
    analysis: finalAnalysis,
    graph: input.graph,
    specificationText: input.specification.rawText,
  }).analysis;
  const analysisStore = createImpactAnalysisArtifactStore(artifactsPath(input.rootDir));
  const persisted = await analysisStore.save(finalAnalysis);
  if (!persisted.ok) {
    return failWith('configurationError', persisted.error.message);
  }
  const evidenceFileById = await evidenceFilesFor(
    input.store,
    finalAnalysis.requirementImpacts.flatMap((impact) => impact.evidenceIds),
  );
  return {
    ok: true,
    value: {
      analysis: finalAnalysis,
      graph: input.graph,
      snapshotId: input.snapshotId,
      evidenceFileById,
      classificationMode,
    },
  };
};
