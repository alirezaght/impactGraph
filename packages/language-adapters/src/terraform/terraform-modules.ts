// `module "x" { source = "./modules/x" }`. A local source names a directory inside the repository,
// and a directory IS a Terraform module — so everything declared there is what the module call
// contains. Resolving that is a path calculation over the scanned file set, which is why it lives
// here as a pure function: the language adapter records the raw `source` string (it only ever sees
// one file), and the `terraform` framework adapter calls this when it has the whole graph.

/**
 * Resolve a local module source against the calling directory, or return undefined.
 *
 * Only `./` and `../` sources are local; a registry or git source names something outside the
 * repository and is reported, never invented. `../` can never climb above the repository root:
 * popping past the root returns undefined, so no `source` string — however many segments it
 * carries — can address a path outside the scanned tree (PRD §42.5).
 */
export const resolveLocalModuleDirectory = (
  fromDirectory: string,
  source: string,
): string | undefined => {
  if (!source.startsWith('./') && !source.startsWith('../')) {
    return undefined;
  }
  const segments = fromDirectory === '' ? [] : fromDirectory.split('/');
  for (const part of source.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part !== '..') {
      segments.push(part);
    } else if (segments.pop() === undefined) {
      return undefined; // escaped the repository root
    }
  }
  return segments.join('/');
};
