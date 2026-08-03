import { useState } from 'react';

import { SeverityText } from '../components/badges.js';

import type { WebviewRequest } from '../messaging.js';
import type { SpecificationQuestionDto } from '@impactgraph/contracts';
import type { JSX } from 'react';

// §18.2 / §40.2 / §C9 — open questions with the answer workflow. Answering appends a
// specification version AND a clarification record on the host; the webview only asks.

interface Props {
  readonly specificationId: string | undefined;
  readonly questions: readonly SpecificationQuestionDto[];
  readonly send: (request: WebviewRequest) => void;
}

const SEVERITY_ORDER: Readonly<Record<string, number>> = {
  blocking: 0,
  important: 1,
  minor: 2,
};

const AnswerForm = ({
  questionId,
  onAnswer,
}: {
  readonly questionId: string;
  readonly onAnswer: (answer: string) => void;
}): JSX.Element => {
  const [answer, setAnswer] = useState('');
  return (
    <div className="answer-form">
      <label htmlFor={`answer-${questionId}`}>Answer</label>
      <textarea
        id={`answer-${questionId}`}
        rows={2}
        value={answer}
        onChange={(event) => {
          setAnswer(event.target.value);
        }}
      />
      <button
        type="button"
        disabled={answer.trim().length === 0}
        onClick={() => {
          onAnswer(answer.trim());
          setAnswer('');
        }}
      >
        Record answer
      </button>
    </div>
  );
};

const QuestionActions = ({
  specificationId,
  questionId,
  send,
}: {
  readonly specificationId: string;
  readonly questionId: string;
  readonly send: (request: WebviewRequest) => void;
}): JSX.Element => (
  <>
    <AnswerForm
      questionId={questionId}
      onAnswer={(answer) => {
        send({
          type: 'webview/answer-question',
          payload: { specificationId, questionId, answer },
        });
      }}
    />
    <button
      type="button"
      onClick={() => {
        send({ type: 'webview/dismiss-question', payload: { specificationId, questionId } });
      }}
    >
      Dismiss question
    </button>
  </>
);

const QuestionRow = ({
  question,
  specificationId,
  send,
}: {
  readonly question: SpecificationQuestionDto;
  readonly specificationId: string | undefined;
  readonly send: (request: WebviewRequest) => void;
}): JSX.Element => (
  <li className="question" data-severity={question.severity}>
    <p className="question__text">{question.question}</p>
    <p className="question__meta">
      <SeverityText severity={question.severity} /> · status: {question.status}
    </p>
    {question.reason.length === 0 ? null : (
      <p className="question__reason">Why it matters: {question.reason}</p>
    )}
    {question.answer === undefined ? null : (
      <p className="question__answer">Answered: {question.answer}</p>
    )}
    {specificationId === undefined || question.answer !== undefined ? null : (
      <QuestionActions specificationId={specificationId} questionId={question.id} send={send} />
    )}
  </li>
);

export const QuestionList = ({ specificationId, questions, send }: Props): JSX.Element => {
  if (questions.length === 0) {
    return <p className="empty-state">No open questions — nothing is blocking this analysis.</p>;
  }
  const ordered = [...questions].sort(
    (left, right) => (SEVERITY_ORDER[left.severity] ?? 3) - (SEVERITY_ORDER[right.severity] ?? 3),
  );
  return (
    <ul className="question-list" aria-label="Open questions">
      {ordered.map((question) => (
        <QuestionRow
          key={question.id}
          question={question}
          specificationId={specificationId}
          send={send}
        />
      ))}
    </ul>
  );
};
