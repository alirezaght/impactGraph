export function loadConfig(): string {
  return process.env.DATABASE_URL ?? 'postgres://localhost/deals';
}

export function searchIndexName(): string {
  return process.env['SEARCH_INDEX'] ?? 'deals';
}
