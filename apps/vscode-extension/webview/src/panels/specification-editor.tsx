import { useEffect, useState } from 'react';

import type { WebviewRequest } from '../messaging.js';
import type { SpecificationPanelStateDto } from '@impactgraph/contracts';
import type { JSX } from 'react';

// §18.2 input half: paste, import (current file / selection), edit, save a version, analyze.
// The editor is local state; nothing is persisted until the user asks the host to persist it.

interface Props {
  readonly state: SpecificationPanelStateDto;
  readonly send: (request: WebviewRequest) => void;
}

const VersionCompare = ({ state, send }: Props): JSX.Element | null => {
  const versions = state.availableVersions;
  const specificationId = state.specification?.id;
  const left = versions[versions.length - 2];
  const right = versions[versions.length - 1];
  if (specificationId === undefined || left === undefined || right === undefined) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={() => {
        send({
          type: 'webview/compare-specification-versions',
          payload: { specificationId, left, right },
        });
      }}
    >
      Compare v{left} with v{right}
    </button>
  );
};

const ImportButtons = ({ send }: { readonly send: Props['send'] }): JSX.Element => (
  <>
    {(['current-file', 'selection'] as const).map((source) => (
      <button
        key={source}
        type="button"
        onClick={() => {
          send({ type: 'webview/import-specification', payload: { source } });
        }}
      >
        {source === 'current-file' ? 'Import current file' : 'Import selection'}
      </button>
    ))}
  </>
);

export const SpecificationEditor = ({ state, send }: Props): JSX.Element => {
  const sourceText = state.draft?.text ?? state.specification?.rawText ?? '';
  const sourceName = state.draft?.name ?? state.specification?.id ?? 'specification.md';
  const [text, setText] = useState(sourceText);
  const [name, setName] = useState(sourceName);
  useEffect(() => {
    setText(sourceText);
    setName(sourceName);
  }, [sourceText, sourceName]);

  return (
    <>
      <label htmlFor="specification-name">Specification name</label>
      <input
        id="specification-name"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <label htmlFor="specification-text">Specification text</label>
      <textarea
        id="specification-text"
        rows={10}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <div className="actions">
        <ImportButtons send={send} />
        <button
          type="button"
          disabled={text.trim().length === 0}
          onClick={() => {
            send({ type: 'webview/save-specification-version', payload: { name, text } });
          }}
        >
          Save specification version
        </button>
        <button
          type="button"
          disabled={text.trim().length === 0}
          onClick={() => {
            send({ type: 'webview/analyze-specification', payload: { name, text } });
          }}
        >
          Analyze specification
        </button>
        <VersionCompare state={state} send={send} />
      </div>
    </>
  );
};
