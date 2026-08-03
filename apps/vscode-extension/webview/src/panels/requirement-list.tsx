import { useState } from 'react';

import type { WebviewRequest } from '../messaging.js';
import type { SpecificationRequirementDto } from '@impactgraph/contracts';
import type { JSX } from 'react';

// §18.2 / §40.2 — extracted requirements with the confirm / reject / edit workflow. Each action
// is a REQUEST; the authoritative list comes back from the host as specification version N+1.

interface Props {
  readonly specificationId: string | undefined;
  readonly requirements: readonly SpecificationRequirementDto[];
  readonly send: (request: WebviewRequest) => void;
}

const EditRow = ({
  requirement,
  onSubmit,
  onCancel,
}: {
  readonly requirement: SpecificationRequirementDto;
  readonly onSubmit: (statement: string) => void;
  readonly onCancel: () => void;
}): JSX.Element => {
  const [statement, setStatement] = useState(requirement.statement);
  return (
    <div className="edit-row">
      <label htmlFor={`edit-${requirement.id}`}>Edit requirement statement</label>
      <textarea
        id={`edit-${requirement.id}`}
        value={statement}
        rows={3}
        onChange={(event) => {
          setStatement(event.target.value);
        }}
      />
      <button
        type="button"
        onClick={() => {
          onSubmit(statement);
        }}
      >
        Save statement
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
};

const DecisionButtons = ({
  specificationId,
  requirementId,
  send,
  onEdit,
}: {
  readonly specificationId: string;
  readonly requirementId: string;
  readonly send: (request: WebviewRequest) => void;
  readonly onEdit: () => void;
}): JSX.Element => (
  <div className="actions">
    {(['confirmed', 'rejected'] as const).map((decision) => (
      <button
        key={decision}
        type="button"
        onClick={() => {
          send({
            type: 'webview/requirement-decision',
            payload: { specificationId, requirementId, decision },
          });
        }}
      >
        {decision === 'confirmed' ? 'Confirm' : 'Reject'}
      </button>
    ))}
    <button type="button" onClick={onEdit}>
      Edit
    </button>
  </div>
);

const RequirementRow = ({
  requirement,
  specificationId,
  send,
}: {
  readonly requirement: SpecificationRequirementDto;
  readonly specificationId: string | undefined;
  readonly send: (request: WebviewRequest) => void;
}): JSX.Element => {
  const [editing, setEditing] = useState(false);
  return (
    <li className="requirement" data-status={requirement.status}>
      <p className="requirement__statement">{requirement.statement}</p>
      <p className="requirement__meta">
        {requirement.type} · status: {requirement.status}
        {requirement.priority === undefined ? '' : ` · priority: ${requirement.priority}`}
      </p>
      {specificationId === undefined ? null : (
        <DecisionButtons
          specificationId={specificationId}
          requirementId={requirement.id}
          send={send}
          onEdit={() => {
            setEditing(!editing);
          }}
        />
      )}
      {editing && specificationId !== undefined ? (
        <EditRow
          requirement={requirement}
          onCancel={() => {
            setEditing(false);
          }}
          onSubmit={(statement) => {
            send({
              type: 'webview/edit-requirement',
              payload: { specificationId, requirementId: requirement.id, statement },
            });
            setEditing(false);
          }}
        />
      ) : null}
    </li>
  );
};

export const RequirementList = ({ specificationId, requirements, send }: Props): JSX.Element => {
  if (requirements.length === 0) {
    return (
      <p className="empty-state">
        No requirements extracted yet. Paste or import a specification, then run Analyze.
      </p>
    );
  }
  return (
    <ul className="requirement-list" aria-label="Extracted requirements">
      {requirements.map((requirement) => (
        <RequirementRow
          key={requirement.id}
          requirement={requirement}
          specificationId={specificationId}
          send={send}
        />
      ))}
    </ul>
  );
};
