import type { CodeGraph } from '../types.js';
import type { DecoratorFact } from '@impactgraph/language-adapters';

// The Spring annotation vocabulary this adapter reads, in one place. Every entry maps a Java
// annotation the language adapter recorded (PRD §31) onto a PRD §12.1 node type — never onto a
// new one. `@Repository` and `@Component` are Spring's own sub-stereotypes of `@Component`; §12
// has no bean-flavour axis, so all three become `service` nodes and the annotation that produced
// each one stays visible in its evidence.

/** Class-level stereotypes → the §12.1 node type each produces. */
export const STEREOTYPES: Readonly<Record<string, string>> = {
  RestController: 'controller',
  Controller: 'controller',
  Service: 'service',
  Repository: 'service',
  Component: 'service',
  Configuration: 'service',
  SpringBootApplication: 'application',
};

/** Method-level mapping annotations → the HTTP verb each pins. */
export const MAPPING_METHODS: Readonly<Record<string, string>> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
};

/** `@RequestMapping` pins no verb by itself — it is both the class prefix and a mapping. */
export const REQUEST_MAPPING = 'RequestMapping';

/** `@Scheduled(cron = "…")` on a method: Spring runs it on a timer. */
export const SCHEDULED = 'Scheduled';

/** `@Bean` on a method of a configuration class: the method IS the bean's factory. */
export const BEAN = 'Bean';

/**
 * Field-injection annotations. `@Inject` (JSR-330) and `@Resource` (JSR-250) are wired by Spring
 * exactly as `@Autowired` is, so all three produce the same fact; which one was written stays
 * visible in the edge's evidence.
 */
export const INJECTION_ANNOTATIONS = new Set(['Autowired', 'Inject', 'Resource']);

const isSpringAnnotationName = (name: string): boolean =>
  name in STEREOTYPES ||
  name in MAPPING_METHODS ||
  name === REQUEST_MAPPING ||
  name === SCHEDULED ||
  name === BEAN ||
  INJECTION_ANNOTATIONS.has(name);

/**
 * Annotation names are not unique across ecosystems — NestJS spells its controller decorator
 * `@Controller` too. Language, not spelling, is what makes an annotation a Spring annotation, so
 * every fact this adapter reads must come from a `.java` file. Without this filter a NestJS
 * repository would sprout Spring controller nodes, which is a wrong fact, not a harmless one.
 */
export const springAnnotations = (graph: CodeGraph): readonly DecoratorFact[] =>
  graph.decorators.filter(
    (fact) =>
      fact.filePath.toLowerCase().endsWith('.java') && isSpringAnnotationName(fact.decoratorName),
  );

/**
 * The path an annotation declares: `@GetMapping("/{id}")`, `@RequestMapping(path = "/deals")` and
 * `@RequestMapping(value = "/deals")` all say the same thing. An annotation with no path segment
 * contributes nothing rather than a guessed default.
 */
export const declaredPath = (fact: DecoratorFact): string => fact.stringArguments[0] ?? '';

/** `method = RequestMethod.GET` → 'GET'; absent → undefined (Spring maps every verb). */
export const declaredVerb = (fact: DecoratorFact): string | undefined => {
  const value = fact.identifierLists['method']?.[0];
  return value === undefined ? undefined : value.slice(value.lastIndexOf('.') + 1).toUpperCase();
};

/** Method node ids read `symbol:<file>#<Class>.<method>` — the owning class is the prefix. */
export const owningClassNodeId = (methodNodeId: string): string =>
  methodNodeId.replace(/\.[^.#]+$/, '');

/** Node name by id for the given §12.1 types — so an annotation is matched to what it annotates. */
export const nodeNamesByType = (
  graph: CodeGraph,
  types: ReadonlySet<string>,
): ReadonlyMap<string, string> =>
  new Map(
    graph.nodes.filter((node) => types.has(node.type)).map((node) => [String(node.id), node.name]),
  );

const TYPE_DECLARATIONS = new Set(['class', 'interface']);

/** Class nodes by id, so a stereotype can be matched to the type it actually annotates. */
export const classNodesById = (graph: CodeGraph): ReadonlyMap<string, string> =>
  nodeNamesByType(graph, TYPE_DECLARATIONS);

/** Method nodes by id — `@Scheduled` and `@Bean` annotate methods, never types. */
export const methodNodesById = (graph: CodeGraph): ReadonlyMap<string, string> =>
  nodeNamesByType(graph, new Set(['method']));
