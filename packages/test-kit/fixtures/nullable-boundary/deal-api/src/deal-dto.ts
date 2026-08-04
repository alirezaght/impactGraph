// The producing side of the observed trial case: `expiresAt` is nullable, and what happens to a
// null on the way to the consumer is the whole question.
export interface DealRow {
  readonly id: string;
  readonly title: string;
  /** Null for deals with no expiry. This is the field the specification is about. */
  readonly expiresAt: string | null;
}

export interface DealDto {
  readonly id: string;
  readonly title: string;
  /** Renamed on the way out: the API contract calls it `expiry`. */
  readonly expiry: string | null;
}

export const toDealDto = (row: DealRow): DealDto => ({
  id: row.id,
  title: row.title,
  expiry: row.expiresAt,
});
