import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { useEffect, useRef } from 'react';

import { graphStylesheet, layoutOptions } from '../graph/style.js';

import type { Core, EdgeSingular, ElementDefinition, NodeSingular } from 'cytoscape';
import type { JSX } from 'react';

// fcose is a layout PLUGIN (ADR-0005) — registered once at module load. Registering twice throws
// in some Cytoscape versions, so this must not move into the component body.
let fcoseRegistered = false;
const registerLayouts = (): void => {
  if (!fcoseRegistered) {
    cytoscape.use(fcose);
    fcoseRegistered = true;
  }
};

// ADR-0005 — the Cytoscape mount. It is a RENDERER: element construction, filtering, and the
// node budget all happen before this component sees anything. Layout runs only when the element
// set actually changes (re-laying out on every message is a known failure mode), and animation
// is disabled under `prefers-reduced-motion` (§37).

interface Props {
  readonly elements: readonly ElementDefinition[];
  readonly onSelect: (nodeId: string) => void;
  /** §18.4: a proposed relationship is selectable, so its evidence is reachable from the canvas. */
  readonly onSelectEdge: (edgeId: string) => void;
  readonly reducedMotion: boolean;
}

/** Nodes and edges are both selectable: a proposed relationship carries evidence of its own. */
const bindSelection = (
  core: Core,
  onSelect: (nodeId: string) => void,
  onSelectEdge: (edgeId: string) => void,
): void => {
  core.on('tap', 'node', (event) => {
    const id = (event.target as NodeSingular).id();
    if (!id.startsWith('group:')) {
      onSelect(id);
    }
  });
  core.on('tap', 'edge', (event) => {
    onSelectEdge((event.target as EdgeSingular).id());
  });
};

const signatureOf = (elements: readonly ElementDefinition[]): string =>
  elements
    .map((element) => String(element.data.id ?? ''))
    .sort()
    .join('|');

export const GraphCanvas = ({
  elements,
  onSelect,
  onSelectEdge,
  reducedMotion,
}: Props): JSX.Element => {
  const container = useRef<HTMLDivElement | null>(null);
  const core = useRef<Core | undefined>(undefined);
  const signature = useRef<string>('');

  useEffect(() => {
    if (container.current === null || core.current !== undefined) {
      return;
    }
    registerLayouts();
    core.current = cytoscape({
      container: container.current,
      style: graphStylesheet,
      wheelSensitivity: 0.2,
      elements: [],
    });
    bindSelection(core.current, onSelect, onSelectEdge);
  }, [onSelect, onSelectEdge]);

  useEffect(() => {
    const cy = core.current;
    if (cy === undefined) {
      return;
    }
    const next = signatureOf(elements);
    if (next === signature.current) {
      return;
    }
    signature.current = next;
    cy.elements().remove();
    cy.add([...elements]);
    cy.layout(layoutOptions(reducedMotion)).run();
  }, [elements, reducedMotion]);

  useEffect(
    () => (): void => {
      core.current?.destroy();
      core.current = undefined;
    },
    [],
  );

  return (
    <div
      className="graph-canvas"
      ref={container}
      data-node-count={elements.length}
      role="img"
      aria-label="Impact graph. The impact list below carries the same information for keyboard and screen-reader use."
    />
  );
};
