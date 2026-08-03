// What an HTML attribute points AT — shared by the standalone `.html` adapter and the `.astro`
// template reader, because the two were drifting and the drift cost real edges (epic-16).
//
// The split is the whole point:
//
// * an ASSET attribute (`<script src>`, `<link href>`, `<img src>`) usually names a file, and a
//   repository-local one becomes an `ImportReference` that assembly resolves into an `IMPORTS`
//   edge with the same machinery and the same file roster as every other language;
// * a NAVIGATION attribute (`<a href>`, `<form action>`) names an endpoint or a page, never a
//   file on disk — so it stays a fact on the `CallFact` channel and correlation is somebody
//   else's job.
//
// A specifier that names no scanned file resolves to nothing (see
// `repository-intelligence/src/assembly/module-resolvers.ts`), so the failure mode of a bad guess
// here is a MISSING edge, never a wrong one — and no `../../..` can escape the repository (§42.5).

// Both tables are `Map`s rather than object literals: the lookup key is a tag name read out of an
// untrusted document, and an object literal answers `constructor` and `__proto__` from its
// prototype (PRD §42.5). `<__proto__ href="…">` must MISS.

/** Tag → the attribute whose value usually names a file. */
const ASSET_ATTRIBUTES = new Map<string, string>([
  ['script', 'src'],
  ['link', 'href'],
  ['img', 'src'],
  ['source', 'src'],
  ['video', 'src'],
  ['audio', 'src'],
  ['iframe', 'src'],
  ['embed', 'src'],
  ['object', 'data'],
]);

/** Tag → the attribute whose value names somewhere to go, not something to load. */
const NAVIGATION_ATTRIBUTES = new Map<string, string>([
  ['a', 'href'],
  ['area', 'href'],
  ['form', 'action'],
]);

/** The attribute this tag points with, and whether that target is a navigation target. */
export interface ReferenceAttribute {
  readonly name: string;
  readonly navigational: boolean;
}

export const referenceAttributeOf = (tagName: string): ReferenceAttribute | undefined => {
  const lower = tagName.toLowerCase();
  const navigation = NAVIGATION_ATTRIBUTES.get(lower);
  if (navigation !== undefined) {
    return { name: navigation, navigational: true };
  }
  const asset = ASSET_ATTRIBUTES.get(lower);
  return asset === undefined ? undefined : { name: asset, navigational: false };
};

/** Anything with a scheme, a protocol-relative or root-relative path, or a bare fragment. */
const NON_LOCAL = /^([a-zA-Z][\w+.-]*:|\/\/|\/|#|\?)/;

/**
 * The module specifier a repository-local asset reference states, or undefined when the value
 * names something outside this repository's file tree.
 *
 * A browser resolves `src="app.js"` against the document, so a bare path is relative — the leading
 * `./` is added to say so in the specifier grammar the resolvers share. Nothing else is rewritten.
 *
 * Root-relative (`/logo.svg`) is deliberately NOT local. In a static site it is the server root; in
 * Astro it is the `public/` directory. Either way the mapping from URL root to a directory on disk
 * is a *deployment* convention this reader cannot see, so the value stays a `CallFact` and the
 * question of what serves it is left to somebody who can answer it.
 */
export const localSpecifier = (value: string): string | undefined => {
  if (NON_LOCAL.test(value) || value.trim() === '') {
    return undefined;
  }
  return value.startsWith('.') ? value : `./${value}`;
};
