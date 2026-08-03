// Where Spring's own convention says a module's configuration lives, and which module a file
// belongs to. Shared by the language adapter that READS `application.yml` and the framework
// adapter that RESOLVES a `@Value` key against it, so the two cannot disagree about scope.
//
// The scope rule matters as much as the parsing. `@Value("${deals.topic}")` in module `service` is
// resolved against `service/src/main/resources/application.yml` and against nothing else: a second
// module's configuration is a different application, and letting one module's key answer another's
// placeholder would produce a topic name that this deployment never uses.

const RESOURCES = 'src/main/resources/';
const SOURCES = 'src/main/java/';

/** Formats Spring Boot loads from the classpath root, in the order it merges them. */
export type SpringConfigFormat = 'yaml' | 'properties';

const FORMATS = new Map<string, SpringConfigFormat>([
  ['.yml', 'yaml'],
  ['.yaml', 'yaml'],
  ['.properties', 'properties'],
]);

export interface SpringConfigResource {
  /** Directory the module rooted at — `''` for a single-module repository. */
  readonly moduleRoot: string;
  readonly format: SpringConfigFormat;
  /** `application-prod.yml` → 'prod'; the unprofiled `application.yml` → undefined. */
  readonly profile?: string;
}

/** `service/src/main/java/com/x/A.java` → 'service'; a file outside a module → undefined. */
const rootBefore = (relativePath: string, segment: string): string | undefined => {
  const marker = relativePath.startsWith(segment) ? 0 : relativePath.indexOf(`/${segment}`);
  if (marker < 0) {
    return undefined;
  }
  return marker === 0 && relativePath.startsWith(segment) ? '' : relativePath.slice(0, marker);
};

/** The module a Java source file belongs to, by the Maven/Gradle layout it is required to use. */
export const springModuleOfSource = (relativePath: string): string | undefined =>
  rootBefore(relativePath, SOURCES);

const FILE_NAME = /^application(?:-([^/]+))?(\.[a-z]+)$/;

/**
 * The Spring configuration resource this path is, or undefined.
 *
 * Deliberately narrow: `src/main/resources/application*.{yml,yaml,properties}` only. `src/test/
 * resources` is excluded because test configuration does not describe the deployed system, and a
 * nested directory is excluded because Spring would not load it from there either. A file this
 * does not recognise is not a Spring property source, so it contributes no values — which is the
 * honest answer, not a missing feature.
 */
export const springConfigResource = (relativePath: string): SpringConfigResource | undefined => {
  const moduleRoot = rootBefore(relativePath, RESOURCES);
  if (moduleRoot === undefined) {
    return undefined;
  }
  const tail = relativePath.slice(relativePath.indexOf(RESOURCES) + RESOURCES.length);
  const matched = FILE_NAME.exec(tail);
  const format = matched === null ? undefined : FORMATS.get(matched[2] ?? '');
  if (matched === null || format === undefined) {
    return undefined;
  }
  const profile = matched[1];
  return { moduleRoot, format, ...(profile === undefined ? {} : { profile }) };
};
