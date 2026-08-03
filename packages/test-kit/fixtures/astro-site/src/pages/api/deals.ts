import type { APIRoute } from 'astro';

export const GET: APIRoute = () =>
  new Response(JSON.stringify([{ id: 'd1', name: 'Project Alpha' }]), {
    headers: { 'content-type': 'application/json' },
  });

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json();
  return new Response(JSON.stringify(body), { status: 201 });
};
