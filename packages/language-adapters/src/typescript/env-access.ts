import ts from 'typescript';

// `process.env.X` / `process.env['X']` — the one expression shape that states an ENVIRONMENT
// VARIABLE NAME outright. Shared by `parse-env.ts` (which records the variable as a node) and
// `parse-pubsub.ts` (which records it as the unresolved half of a topic name), so the two can
// never drift into disagreeing about what counts.
//
// Deliberately narrow. `const { TOPIC } = process.env` states a name too, but it also introduces a
// binding whose later reads this reader would have to track, and a destructured name may be
// reassigned or shadowed. `env.TOPIC` after `const env = process.env` is the same problem one hop
// away. Both resolve to nothing rather than to a guess; the whole point of these channels is that
// the fact recorded is one the source states on the line the evidence points at.
//
// `process.env.X ?? 'fallback'` is refused for the reason that matters everywhere here: the
// expression states TWO possible values and the source does not say which one runs. Type-level
// wrappers are a different matter — `process.env.X!`, `(process.env.X)` and `process.env.X as
// string` all erase at compile time and read exactly the same variable, so they are unwrapped.

/** Wrappers that change nothing at runtime, so the expression underneath is the real one. */
const unwrap = (node: ts.Node): ts.Node => {
  if (
    ts.isNonNullExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return unwrap(node.expression);
  }
  return node;
};

const isProcessEnv = (candidate: ts.Node): boolean => {
  const node = unwrap(candidate);
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process' &&
    node.name.text === 'env'
  );
};

/** The environment variable this expression reads, or undefined for anything else. */
export const envAccessName = (candidate: ts.Node): string | undefined => {
  const node = unwrap(candidate);
  if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) {
    return node.name.text;
  }
  if (
    ts.isElementAccessExpression(node) &&
    isProcessEnv(node.expression) &&
    ts.isStringLiteral(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return undefined;
};
