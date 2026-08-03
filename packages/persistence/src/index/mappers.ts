import { storageError } from '@impactgraph/application';
import {
  evidenceRecordArtifactSchema,
  graphEdgeArtifactSchema,
  graphNodeArtifactSchema,
  repositorySnapshotArtifactSchema,
} from '@impactgraph/contracts';
import {
  err,
  ok,
  parseEvidenceRecord,
  parseGraphEdge,
  parseGraphNode,
  parseRepositorySnapshot,
  serializeEvidenceRecord,
  serializeGraphEdge,
  serializeGraphNode,
  serializeRepositorySnapshot,
} from '@impactgraph/domain';

import type { StorageError } from '@impactgraph/application';
import type {
  EvidenceRecord,
  GraphEdge,
  GraphNode,
  RepositorySnapshot,
  Result,
  ValidationError,
} from '@impactgraph/domain';

// Write path: domain → serialized DTO → Zod gate → row. Read path: payload → Zod gate →
// domain parse. DTOs never leak past this file (ADR-0006; main skill §5).

export const nodeToRow = (node: GraphNode): Record<string, unknown> => {
  const dto = graphNodeArtifactSchema.parse(serializeGraphNode(node));
  return {
    id: dto.id,
    snapshot_id: dto.knowledge.repositorySnapshotId,
    category: dto.category,
    type: dto.type,
    name: dto.name,
    path: dto.path ?? null,
    provenance: dto.knowledge.provenance,
    payload: JSON.stringify(dto),
  };
};

export const edgeToRow = (edge: GraphEdge): Record<string, unknown> => {
  const dto = graphEdgeArtifactSchema.parse(serializeGraphEdge(edge));
  return {
    id: dto.id,
    snapshot_id: dto.knowledge.repositorySnapshotId,
    type: dto.type,
    source_id: dto.sourceId,
    target_id: dto.targetId,
    provenance: dto.knowledge.provenance,
    payload: JSON.stringify(dto),
  };
};

export const evidenceToRow = (record: EvidenceRecord): Record<string, unknown> => {
  const dto = evidenceRecordArtifactSchema.parse(serializeEvidenceRecord(record));
  return {
    id: dto.id,
    snapshot_id: dto.repositorySnapshotId,
    kind: dto.kind,
    payload: JSON.stringify(dto),
  };
};

export const snapshotToRow = (snapshot: RepositorySnapshot): Record<string, unknown> => {
  const dto = repositorySnapshotArtifactSchema.parse(serializeRepositorySnapshot(snapshot));
  return { id: dto.id, created_at: dto.createdAt, payload: JSON.stringify(dto) };
};

type ZodLikeSchema = { safeParse(value: unknown): { success: boolean } };
type DomainParser<T> = (value: unknown) => Result<T, ValidationError>;

const fromPayload =
  <T>(schema: ZodLikeSchema, parse: DomainParser<T>, what: string) =>
  (payload: string): Result<T, StorageError> => {
    let raw: unknown;
    try {
      raw = JSON.parse(payload);
    } catch {
      return err(storageError('corruption', `${what} payload is not valid JSON`));
    }
    if (!schema.safeParse(raw).success) {
      return err(storageError('corruption', `${what} payload failed schema validation`));
    }
    const parsed = parse(raw);
    if (!parsed.ok) {
      return err(storageError('corruption', `${what} payload failed domain validation`));
    }
    return ok(parsed.value);
  };

export const nodeFromPayload = fromPayload(graphNodeArtifactSchema, parseGraphNode, 'node');
export const edgeFromPayload = fromPayload(graphEdgeArtifactSchema, parseGraphEdge, 'edge');
export const evidenceFromPayload = fromPayload(
  evidenceRecordArtifactSchema,
  parseEvidenceRecord,
  'evidence',
);
export const snapshotFromPayload = fromPayload(
  repositorySnapshotArtifactSchema,
  parseRepositorySnapshot,
  'snapshot',
);
