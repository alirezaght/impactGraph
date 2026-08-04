// The consuming side, in a different service. Nothing here imports the producer: the only shared
// fact is the URL and the field names in the payload.
export interface RemoteDeal {
  readonly id: string;
  readonly title: string;
  readonly expiry: string | null;
}

export const fetchDeals = async (): Promise<readonly RemoteDeal[]> => {
  const response = await fetch('https://deal-api.example.com/api/deals');
  return (await response.json()) as readonly RemoteDeal[];
};
