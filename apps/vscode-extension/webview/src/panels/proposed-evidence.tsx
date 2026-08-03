import { Absent, ConfidenceText, KnowledgeBadge } from '../components/badges.js';
import { PROPOSED_BADGE, proposedEdgeSummary } from '../graph/proposed.js';

import { SignalList } from './evidence-sections.js';

import type { ProposedSelection } from '../graph/proposed.js';
import type { ProposedStructureViewDto } from '@impactgraph/contracts';
import type { JSX } from 'react';

// §18.5 for the proposed half of §18.4. Every field here already travels on the graph DTO, so no
// host round-trip is needed and nothing is fetched, derived or guessed.
//
// The panel's first job is to refuse false authority (§43.6): a proposal is an AI-assisted
// interpretation of an architectural option, it does not exist in the repository, and both of
// those facts are stated in words before any number is shown.

interface Props {
  readonly selection: ProposedSelection;
  readonly structure: ProposedStructureViewDto | undefined;
  readonly onClear: () => void;
}

const Endpoints = ({ selection }: Pick<Props, 'selection'>): JSX.Element | null => {
  if (selection.kind !== 'relationship') {
    return null;
  }
  const record = selection.record;
  return (
    <>
      <dt>Relationship</dt>
      <dd>{proposedEdgeSummary(record)}</dd>
      <dt>Source</dt>
      <dd>
        {record.sourceId} ({record.sourceKind} component)
      </dd>
      <dt>Target</dt>
      <dd>
        {record.targetId} ({record.targetKind} component)
      </dd>
      <dt>Edge type</dt>
      <dd>{record.type}</dd>
      <dt>Status</dt>
      <dd data-state="proposed">proposed — not present in the repository</dd>
    </>
  );
};

const Component = ({ selection }: Pick<Props, 'selection'>): JSX.Element | null => {
  if (selection.kind !== 'component') {
    return null;
  }
  return (
    <>
      <dt>Component</dt>
      <dd>{selection.record.name}</dd>
      <dt>Kind</dt>
      <dd>
        {selection.record.category} / {selection.record.type}
      </dd>
      <dt>Status</dt>
      <dd data-state="proposed">proposed — would be created; it does not exist yet</dd>
    </>
  );
};

/** §26/§C8: a proposal never exists without the option that implies it — so name that option. */
const OriginOption = ({ selection, structure }: Omit<Props, 'onClear'>): JSX.Element => {
  const { originOptionId, originOptionTitle } = selection.record;
  const siblings = [
    ...(structure?.relationships ?? []).filter(
      (entry) => entry.originOptionId === originOptionId && entry.id !== selection.record.id,
    ),
    ...(structure?.nodes ?? []).filter(
      (entry) => entry.originOptionId === originOptionId && entry.id !== selection.record.id,
    ),
  ];
  return (
    <section className="proposed-origin" aria-label="Architectural option that proposed this">
      <h4>Proposed by</h4>
      <p data-option-id={originOptionId}>
        {originOptionTitle ?? 'Option title not carried by this graph'} (
        <code>{originOptionId}</code>)
      </p>
      {siblings.length === 0 ? (
        <p className="absent">This option proposes nothing else in the current graph.</p>
      ) : (
        <ul className="proposed-siblings" aria-label="Other proposals from the same option">
          {siblings.map((entry) => (
            <li key={entry.id}>
              [{PROPOSED_BADGE}] {'name' in entry ? entry.name : proposedEdgeSummary(entry)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const EvidenceIds = ({ ids }: { readonly ids: readonly string[] }): JSX.Element =>
  ids.length === 0 ? (
    <Absent what="Evidence records" />
  ) : (
    <ul className="evidence-ids" aria-label="Evidence records">
      {ids.map((id) => (
        <li key={id}>{id}</li>
      ))}
    </ul>
  );

export const ProposedEvidencePanel = ({ selection, structure, onClear }: Props): JSX.Element => {
  const record = selection.record;
  return (
    <section className="panel panel--evidence panel--proposed" aria-labelledby="evidence-heading">
      <h2 id="evidence-heading">Evidence</h2>
      <h3 className="evidence__target" data-state="proposed">
        {selection.kind === 'relationship' ? 'Proposed relationship' : 'Proposed component'}{' '}
        <span className="badge badge--proposed" data-state="proposed" title="Proposed structure">
          {PROPOSED_BADGE}
        </span>{' '}
        <KnowledgeBadge provenance={record.provenance} category={record.knowledgeCategory} />
      </h3>
      <p className="proposed__caveat" role="note">
        This is proposed structure, not a fact: an architectural option would create it, the
        repository does not contain it, and the proposal is AI-assisted rather than verified.
      </p>
      <dl className="evidence-summary">
        <Endpoints selection={selection} />
        <Component selection={selection} />
        <dt>Rationale</dt>
        <dd>{record.rationale}</dd>
        <dt>Provenance</dt>
        <dd>{record.provenance}</dd>
        <dt>Confidence</dt>
        <dd>
          <ConfidenceText confidence={record.confidence} />
        </dd>
      </dl>
      <h4>Why this confidence (§14)</h4>
      <SignalList signals={record.confidenceSignals} />
      <OriginOption selection={selection} structure={structure} />
      <h4>Evidence records</h4>
      <EvidenceIds ids={record.evidenceIds} />
      <button type="button" onClick={onClear}>
        Back to current-structure evidence
      </button>
    </section>
  );
};
