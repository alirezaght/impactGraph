import { ConfidenceText, KnowledgeBadge } from '../components/badges.js';
import {
  PROPOSED_BADGE,
  proposedEdgeAria,
  proposedEdgeSummary,
  proposedNodeAria,
} from '../graph/proposed.js';

import type { ProposedSelection, StructureView } from '../graph/proposed.js';
import type { ProposedStructureViewDto } from '@impactgraph/contracts';
import type { JSX } from 'react';

// §37 tree parity for the §18.4 proposed half: everything the canvas draws with a long-dash line
// is also a focusable list item here, whose text says "proposed" in words. The graph is never the
// only way to reach a proposal — and the list is what a screen reader actually reads.

interface Props {
  readonly structure: ProposedStructureViewDto | undefined;
  readonly view: StructureView;
  readonly selectedId: string | undefined;
  readonly onSelect: (selection: ProposedSelection) => void;
}

const Row = ({
  id,
  summary,
  ariaLabel,
  provenance,
  confidence,
  selected,
  onSelect,
}: {
  readonly id: string;
  readonly summary: string;
  readonly ariaLabel: string;
  readonly provenance: string;
  readonly confidence: number;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): JSX.Element => (
  <li
    className="proposed-row"
    data-proposed-id={id}
    data-state="proposed"
    aria-current={selected ? 'true' : undefined}
  >
    <button
      type="button"
      className="proposed-row__select"
      aria-label={ariaLabel}
      onClick={onSelect}
    >
      {summary}
    </button>
    <KnowledgeBadge provenance={provenance} />
    <ConfidenceText confidence={confidence} />
  </li>
);

/** Designed empty state: absence is stated, never left as a blank column (§43.6). */
const NoProposals = (): JSX.Element => (
  <p className="empty-state" data-state="proposed">
    No proposed structure: the analysis did not assert that any architectural option would create a
    new component or relationship.
  </p>
);

const Heading = ({
  relationshipCount,
  componentCount,
}: {
  readonly relationshipCount: number;
  readonly componentCount: number;
}): JSX.Element => (
  <>
    <h3 id="proposed-heading">
      Proposed structure — {relationshipCount} relationship(s), {componentCount} component(s)
    </h3>
    <p className="proposed__caveat">
      [{PROPOSED_BADGE}] entries do not exist in the repository. They are what an architectural
      option would create, proposed by AI and not verified.
    </p>
  </>
);

export const ProposedList = ({
  structure,
  view,
  selectedId,
  onSelect,
}: Props): JSX.Element | null => {
  if (view === 'current-only') {
    return null;
  }
  const relationships = structure?.relationships ?? [];
  const components = structure?.nodes ?? [];
  if (relationships.length === 0 && components.length === 0) {
    return <NoProposals />;
  }
  return (
    <section className="proposed" aria-labelledby="proposed-heading">
      <Heading relationshipCount={relationships.length} componentCount={components.length} />
      <ul
        className="proposed-list"
        aria-label="Proposed structure (keyboard equivalent of the graph)"
      >
        {relationships.map((relationship) => (
          <Row
            key={relationship.id}
            id={relationship.id}
            summary={proposedEdgeSummary(relationship)}
            ariaLabel={proposedEdgeAria(relationship)}
            provenance={relationship.provenance}
            confidence={relationship.confidence}
            selected={selectedId === relationship.id}
            onSelect={() => {
              onSelect({ kind: 'relationship', record: relationship });
            }}
          />
        ))}
        {components.map((component) => (
          <Row
            key={component.id}
            id={component.id}
            summary={`[${PROPOSED_BADGE}] ${component.name} (${component.type})`}
            ariaLabel={proposedNodeAria(component)}
            provenance={component.provenance}
            confidence={component.confidence}
            selected={selectedId === component.id}
            onSelect={() => {
              onSelect({ kind: 'component', record: component });
            }}
          />
        ))}
      </ul>
    </section>
  );
};
