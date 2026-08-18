import { primaryEvidenceType } from '../impact/evidence-basis.js';
import { evidenceTypesOf } from '../impact/impact-accessors.js';

import { ARTIFACT_CATEGORIES } from './actual-impact.js';

import type { ActualImpact, ArtifactCategory, EvaluationMetrics } from './actual-impact.js';
import type { ImpactEvidenceType } from '../impact/evidence-basis.js';
import type { ImpactAnalysis, ImpactLikelihood } from '../impact/impact-analysis.js';

/**
 * Compute precision, recall and ranking quality of one analysis against one recorded outcome
 * (item 12). Pure: the same pair always yields the same figures, and nothing here mutates either
 * record.
 */

/** Tiers judged as predictions by default. `lexical-only` is NOT a prediction, so it is excluded. */
export const DEFAULT_JUDGED_TIERS: readonly ImpactLikelihood[] = ['required', 'likely'];

export interface MeasureInput {
  readonly analysis: ImpactAnalysis;
  readonly actual: ActualImpact;
  /** Repository path of each predicted node id. Impacts without a path cannot be judged by file. */
  readonly pathByNodeId: ReadonlyMap<string, string>;
  readonly judgedTiers?: readonly ImpactLikelihood[];
  /** Relationship types present on the routes of predicted impacts, for the missed-type figure. */
  readonly predictedRelationshipTypes?: ReadonlySet<string>;
  /** Artifact categories the analysis predicted, for the missed-category figure. */
  readonly predictedArtifactCategories?: readonly ArtifactCategory[];
}

const ratio = (part: number, whole: number): number | undefined =>
  whole === 0 ? undefined : Math.round((part / whole) * 100) / 100;

/**
 * Ranked predicted paths, strongest first, deduplicated.
 *
 * Ranking quality is measured over the ranked list rather than the set, because "was it in the
 * result" and "was it findable" are different questions and the trials complained about the second.
 */
const rankedPaths = (
  input: MeasureInput,
  tiers: readonly ImpactLikelihood[],
): readonly string[] => {
  const rank: Readonly<Record<string, number>> = { required: 0, likely: 1, possible: 2 };
  const ordered = [...input.analysis.requirementImpacts]
    .filter((impact) => tiers.includes(impact.likelihood))
    .sort(
      (a, b) =>
        (rank[a.likelihood] ?? 9) - (rank[b.likelihood] ?? 9) || b.confidence - a.confidence,
    );
  const paths: string[] = [];
  for (const impact of ordered) {
    const path = input.pathByNodeId.get(impact.nodeId);
    if (path !== undefined && !paths.includes(path)) {
      paths.push(path);
    }
  }
  return paths;
};

/** Mean reciprocal rank over the changed files that were predicted at all. */
const meanReciprocalRank = (
  ranked: readonly string[],
  changed: readonly string[],
): number | undefined => {
  const found = changed
    .map((path) => ranked.indexOf(path))
    .filter((index) => index >= 0)
    .map((index) => 1 / (index + 1));
  return found.length === 0
    ? undefined
    : Math.round((found.reduce((sum, value) => sum + value, 0) / found.length) * 100) / 100;
};

/** Cues in a changed path that show an artifact of a given category was in fact needed. */
const CATEGORY_CUES: readonly (readonly [ArtifactCategory, RegExp])[] = [
  ['new-locale-entry', /(^|\/)(locales?|i18n|lang|translations?|messages)(\/|$)/i],
  ['new-test', /(\.|_)(test|spec)\.[a-z0-9]+$|(^|\/)(tests?|__tests__|spec)\//i],
  ['new-migration', /(^|\/)(migrations?|migrate|alembic\/versions|flyway|liquibase)(\/|$)/i],
  ['new-contract-definition', /(openapi|asyncapi|swagger|\.schema\.json|proto)/i],
  ['new-configuration-entry', /(\.tf$|\.tfvars$|(^|\/)config(uration)?(\/|\.)|\.env\.)/i],
  ['new-event-handler', /(handler|consumer|subscriber|projection|listener)/i],
];

const neededCategories = (actual: ActualImpact): readonly ArtifactCategory[] => {
  const added = [...actual.addedFiles];
  return ARTIFACT_CATEGORIES.filter((category) =>
    CATEGORY_CUES.some(
      ([candidate, pattern]) => candidate === category && added.some((path) => pattern.test(path)),
    ),
  );
};

/** Relationship types on the routes of predicted impacts — what the analysis "saw". */
const routeTypesOf = (input: MeasureInput): ReadonlySet<string> =>
  input.predictedRelationshipTypes ?? new Set<string>();

export const measureAnalysis = (input: MeasureInput): EvaluationMetrics => {
  const tiers = input.judgedTiers ?? DEFAULT_JUDGED_TIERS;
  const judged = input.analysis.requirementImpacts.filter((impact) =>
    tiers.includes(impact.likelihood),
  );
  const predictedPaths = new Set(
    judged
      .map((impact) => input.pathByNodeId.get(impact.nodeId))
      .filter((path): path is string => path !== undefined),
  );
  // Added files count as touched: predicting a NEW file by exact path is not expected (item 8), so a
  // prediction that named its directory neighbour is neither credited nor punished by path identity —
  // but the recall denominator must still include it, because it was work the change required.
  const touched = new Set([...input.actual.changedFiles, ...input.actual.removedFiles]);
  const truePositives = [...predictedPaths].filter((path) => touched.has(path)).sort();
  const falsePositives = [...predictedPaths].filter((path) => !touched.has(path)).sort();
  const falseNegatives = [...touched].filter((path) => !predictedPaths.has(path)).sort();
  const ranked = rankedPaths(input, tiers);
  const routeTypes = routeTypesOf(input);
  const predictedCategories = input.predictedArtifactCategories ?? [];
  // Each figure is omitted rather than zeroed when it cannot be computed honestly: precision 0 and
  // "there were no predictions to judge" are different facts, and a consumer must be able to tell.
  const precision = ratio(truePositives.length, predictedPaths.size);
  const recall = ratio(truePositives.length, touched.size);
  const rankingQuality = meanReciprocalRank(ranked, [...touched]);
  return {
    analysisId: input.analysis.id,
    actualImpactId: input.actual.id,
    ...(precision === undefined ? {} : { precision }),
    ...(recall === undefined ? {} : { recall }),
    truePositives,
    falsePositives,
    falseNegatives,
    ...(rankingQuality === undefined ? {} : { rankingQuality }),
    missedArtifactCategories: neededCategories(input.actual).filter(
      (category) => !predictedCategories.includes(category),
    ),
    missedRelationshipTypes: [
      ...new Set(
        input.actual.relationshipChanges
          .filter((change) => change.kind === 'added' && !routeTypes.has(change.type))
          .map((change) => change.type),
      ),
    ].sort(),
    judgedTiers: [...tiers],
    falsePositiveBases: falsePositiveBases(input, judged, falsePositives),
  };
};

/**
 * The evidence bases behind the false positives.
 *
 * This is the field that makes a precision number actionable. "Precision 0.4" says the tool is
 * noisy; "precision 0.4, and every false positive was `transitive-structural`" says which rule to
 * look at.
 */
const falsePositiveBases = (
  input: MeasureInput,
  judged: ImpactAnalysis['requirementImpacts'],
  falsePositives: readonly string[],
): readonly ImpactEvidenceType[] => {
  const paths = new Set(falsePositives);
  const bases = judged
    .filter((impact) => {
      const path = input.pathByNodeId.get(impact.nodeId);
      return path !== undefined && paths.has(path);
    })
    .map((impact) => primaryEvidenceType(evidenceTypesOf(impact)));
  return [...new Set(bases)].sort();
};
