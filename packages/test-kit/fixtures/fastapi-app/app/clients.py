"""Outbound HTTP from this service — the shape that must NOT correlate with our own routes.

`registry` has a stated `base_url` naming another origin, so `registry.get("/deals")` names
`https://registry.example.com/deals`, not this application's `GET /deals` route. The path is
deliberately one this app also serves: if the adapter ever widened its rule from "the client is
handed this app" to "the path is root-relative", the mistake would appear in the golden as a
confident, wrong USES edge instead of hiding.
"""

import httpx

registry = httpx.AsyncClient(base_url="https://registry.example.com")


async def load_registry_deals() -> list[dict[str, str]]:
    response = await registry.get("/deals")
    return response.json()


async def load_absolute() -> dict[str, str]:
    async with httpx.AsyncClient() as client:
        response = await client.get("https://registry.example.com/deals")
        return response.json()
