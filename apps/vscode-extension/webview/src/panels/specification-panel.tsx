import { QuestionList } from './question-list.js';
import { RequirementList } from './requirement-list.js';
import { SpecificationEditor } from './specification-editor.js';

import type { WebviewRequest } from '../messaging.js';
import type { SpecificationPanelStateDto } from '@impactgraph/contracts';
import type { JSX } from 'react';

// Story 9.1 — §18.2 specification view: paste/import/edit, extracted requirements, open
// questions with the answer workflow, version save/compare, and "run the analysis from here".

interface Props {
  readonly state: SpecificationPanelStateDto;
  readonly send: (request: WebviewRequest) => void;
}

/** §C10 readiness — a deterministic estimate; shown as a number with its recommended action. */
const Readiness = ({
  state,
}: {
  readonly state: SpecificationPanelStateDto;
}): JSX.Element | null => {
  const readiness = state.readiness;
  if (readiness === undefined) {
    return null;
  }
  return (
    <p className="readiness" data-score={readiness.score}>
      Implementation readiness: {readiness.score}/100 · {readiness.blockingQuestions} blocking,{' '}
      {readiness.importantQuestions} important open questions. {readiness.recommendedAction}
    </p>
  );
};

const SpecificationMeta = ({
  state,
}: {
  readonly state: SpecificationPanelStateDto;
}): JSX.Element | null => {
  const specification = state.specification;
  if (specification === undefined) {
    return null;
  }
  return (
    <p className="specification__meta">
      {specification.title} · version {specification.version}
      {specification.extractionMode === undefined
        ? ''
        : ` · extraction: ${specification.extractionMode}`}
    </p>
  );
};

export const SpecificationPanel = ({ state, send }: Props): JSX.Element => (
  <section className="panel panel--specification" aria-labelledby="specification-heading">
    <h2 id="specification-heading">Specification</h2>
    {state.status === 'empty' && state.draft === undefined ? (
      <p className="empty-state">
        Paste a specification below, or import the current Markdown file / editor selection.
      </p>
    ) : null}
    <SpecificationEditor state={state} send={send} />
    <SpecificationMeta state={state} />
    <Readiness state={state} />
    {state.warnings.map((warning) => (
      <p key={warning} className="warning" role="status">
        {warning}
      </p>
    ))}
    <h3>Requirements ({state.requirements.length})</h3>
    <RequirementList
      specificationId={state.specification?.id}
      requirements={state.requirements}
      send={send}
    />
    <h3>Open questions ({state.openQuestions.length})</h3>
    <QuestionList
      specificationId={state.specification?.id}
      questions={state.openQuestions}
      send={send}
    />
  </section>
);
