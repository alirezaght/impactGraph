// The import is RENAMED on purpose (epic-16 line 140). Renaming a binding must not change the
// graph: the CALLS edge below still has to land on `createRepository` in ../lib/deal-repository,
// because that is the symbol this file calls. Before the assembler learned to translate a local
// alias back to the exported name it looked `buildRepository` up in that file's export table,
// found nothing, and dropped the edge — so this golden losing a line is the regression signal.
import { createRepository as buildRepository } from '../lib/deal-repository';

export function getDeals(): string[] {
  return buildRepository().findAll();
}
