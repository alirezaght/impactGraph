const base = process.env.NEWSLETTER_SERVICE_URL ?? '';

export async function loadIssues(): Promise<unknown> {
  const response = await fetch(`${base}/api/issues`);
  return response.json();
}
