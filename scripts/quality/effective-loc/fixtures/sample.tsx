// sample.tsx — JSX edge cases for the analyzer. Expected effective lines: 13.

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [tagName: string]: Record<string, unknown>;
    }
  }
}

export interface PanelProps {
  title: string;
}

export function Panel(props: PanelProps): unknown {
  return (
    <section title={props.title}>
      {/* a JSX comment container is a punctuation-only line and does not count */}
      <h1>{props.title}</h1>
      Plain JSX text counts as code
      <hr />
    </section>
  );
}
