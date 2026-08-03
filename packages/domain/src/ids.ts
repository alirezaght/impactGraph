// Branded identifier types. Values are produced by the identifier port (application layer)
// or by adapters; the domain only guarantees they are non-blank at construction time.
declare const brandSymbol: unique symbol;

type Brand<Name extends string> = { readonly [brandSymbol]: Name };

export type NodeId = string & Brand<'NodeId'>;
export type EdgeId = string & Brand<'EdgeId'>;
export type EvidenceId = string & Brand<'EvidenceId'>;
export type RepositorySnapshotId = string & Brand<'RepositorySnapshotId'>;
export type AnalysisRunId = string & Brand<'AnalysisRunId'>;
export type SpecificationId = string & Brand<'SpecificationId'>;
