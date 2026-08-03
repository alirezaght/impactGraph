// Application-side model of `.impactgraph/` project knowledge (PRD §16–17, §27).
// Structurally mirrors the contracts DTOs; composition roots map DTO → these types so the
// application layer keeps its domain-only dependency rule.

export interface ArchitectureContext {
  readonly name: string;
  readonly paths: readonly string[];
}

export interface ComponentAssignment {
  readonly path: string;
  readonly role?: string | undefined;
  readonly context?: string | undefined;
}

/** Human-confirmed architecture knowledge — authoritative over detection (§Z5, §43.3). */
export interface ArchitectureModel {
  readonly contexts: readonly ArchitectureContext[];
  readonly components: readonly ComponentAssignment[];
}

export interface DependencyDirectionRule {
  readonly id: string;
  readonly type: 'dependency-direction';
  readonly description?: string | undefined;
  readonly sourceRole?: string | undefined;
  readonly sourceContext?: string | undefined;
  readonly forbiddenTargetRole?: string | undefined;
  readonly forbiddenTargetContext?: string | undefined;
}

export interface AccompanyingChangeRule {
  readonly id: string;
  readonly type: 'accompanying-change';
  readonly description?: string | undefined;
  readonly whenChanged: string;
  readonly requireChanged: string;
}

export type ArchitectureRule = DependencyDirectionRule | AccompanyingChangeRule;

/** Every violation carries evidence (§27) — the files and graph elements that prove it. */
export interface RuleViolation {
  readonly ruleId: string;
  readonly message: string;
  readonly evidence: {
    readonly filePaths: readonly string[];
    readonly edgeId?: string | undefined;
    readonly sourceNodeId?: string | undefined;
    readonly targetNodeId?: string | undefined;
  };
}
