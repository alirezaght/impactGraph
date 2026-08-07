import { Absent, ConfidenceText, KnowledgeBadge, TierCapMarker } from '../components/badges.js';

import type { WebviewRequest } from '../messaging.js';
import type {
  EvidencePanelStateDto,
  GraphConfidenceSignalDto,
  NodeExplanationDto,
} from '@impactgraph/contracts';
import type { JSX } from 'react';

// §18.5 sections. Fields absent from the DTO render as EXPLICITLY absent — never fabricated and
// never defaulted to a reassuring value (§43.6).

export const ImpactSummary = ({
  impact,
}: {
  readonly impact: EvidencePanelStateDto['impact'];
}): JSX.Element => {
  if (impact === undefined) {
    return <Absent what="Impact classification" />;
  }
  return (
    <dl className="evidence-summary">
      <dt>Requirement</dt>
      <dd>{impact.requirementStatement}</dd>
      <dt>Expected change</dt>
      <dd>{impact.expectedChange}</dd>
      <dt>Likelihood</dt>
      <dd>
        {impact.likelihood} <TierCapMarker cappedBy={impact.tierCappedBy} />
      </dd>
      <dt>Evidence basis</dt>
      {/* ADR-0015: WHY the impact was selected, strongest first. Absence is stated, never
          defaulted — and it stays apart from the §3 provenance row below. */}
      <dd className="evidence-basis">
        {impact.evidenceTypes === undefined
          ? 'not reported by the analysis'
          : impact.evidenceTypes.join(', ')}
      </dd>
      <dt>Directness</dt>
      <dd data-directness={impact.directness}>{impact.directness}</dd>
      <dt>Confidence</dt>
      <dd>
        <ConfidenceText confidence={impact.confidence} />
      </dd>
      <dt>Provenance</dt>
      <dd>
        {impact.provenance ?? 'not reported'} <KnowledgeBadge provenance={impact.provenance} />
      </dd>
      <dt>Dependency path</dt>
      <dd>
        {impact.dependencyPath.length === 0
          ? 'direct — no intermediate hops'
          : impact.dependencyPath.join(' → ')}
      </dd>
    </dl>
  );
};

/**
 * §14 — the "why this score" breakdown, for any record that carries signals. A score without its
 * contributing signals is not acceptable anywhere in this panel.
 */
export const SignalList = ({
  signals,
}: {
  readonly signals: readonly GraphConfidenceSignalDto[];
}): JSX.Element => {
  if (signals.length === 0) {
    return <Absent what="Confidence signals" />;
  }
  return (
    <ul className="confidence-signals" aria-label="Contributing confidence signals">
      {signals.map((signal) => (
        <li key={`${signal.type}:${String(signal.contribution)}`} className="signal">
          <span className="signal__sign">{signal.contribution >= 0 ? '+' : '−'}</span> {signal.type}{' '}
          ({signal.contribution >= 0 ? '+' : ''}
          {signal.contribution.toFixed(2)})
          {signal.description === undefined ? '' : ` — ${signal.description}`}
        </li>
      ))}
    </ul>
  );
};

export const ConfidenceSignals = ({
  explanation,
}: {
  readonly explanation: NodeExplanationDto | undefined;
}): JSX.Element =>
  explanation === undefined ? (
    <Absent what="Confidence signals" />
  ) : (
    <SignalList signals={explanation.knowledge.confidenceSignals} />
  );

export const SourceList = ({
  title,
  files,
  send,
}: {
  readonly title: string;
  readonly files: readonly string[];
  readonly send: (request: WebviewRequest) => void;
}): JSX.Element => {
  if (files.length === 0) {
    return <Absent what={title} />;
  }
  return (
    <ul className="source-list" aria-label={title}>
      {files.map((file) => (
        <li key={file}>
          {file.startsWith('commit ') ? (
            <span>{file}</span>
          ) : (
            <button
              type="button"
              onClick={() => {
                send({ type: 'webview/open-source', payload: { path: file } });
              }}
            >
              {file}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
};

/** Evidence records with their ranges (§40.4): clicking reveals the declaration, not the file top. */
export const EvidenceRecords = ({
  explanation,
  send,
}: {
  readonly explanation: NodeExplanationDto | undefined;
  readonly send: (request: WebviewRequest) => void;
}): JSX.Element => {
  if (explanation === undefined || explanation.knowledge.evidence.length === 0) {
    return <Absent what="Evidence records" />;
  }
  return (
    <ul className="evidence-records" aria-label="Evidence records">
      {explanation.knowledge.evidence.map((record) => (
        <li key={record.id}>
          <button
            type="button"
            disabled={record.source.startsWith('commit ') || record.source === 'unresolved'}
            onClick={() => {
              send({
                type: 'webview/open-source',
                payload: {
                  path: record.source,
                  ...(record.range === undefined ? {} : { range: record.range }),
                },
              });
            }}
          >
            {record.source}
            {record.range === undefined ? '' : ` : ${String(record.range.startLine)}`}
          </button>
        </li>
      ))}
    </ul>
  );
};

export const DecisionList = ({
  decisions,
}: {
  readonly decisions: EvidencePanelStateDto['humanDecisions'];
}): JSX.Element => {
  if (decisions.length === 0) {
    return <Absent what="Human decisions" />;
  }
  return (
    <ul className="decision-list" aria-label="Human decisions">
      {decisions.map((decision, index) => (
        <li key={`${decision.decision}-${String(index)}`}>
          {decision.decision}
          {decision.reason === undefined ? '' : ` — ${decision.reason}`}
          {decision.recordedAt === undefined ? '' : ` (${decision.recordedAt})`}
        </li>
      ))}
    </ul>
  );
};
