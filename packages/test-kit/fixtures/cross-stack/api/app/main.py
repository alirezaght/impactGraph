"""The backend half: the routes the Astro templates point at."""

from fastapi import FastAPI

app = FastAPI(title="deals-api")


@app.get("/api/deals")
def list_deals() -> list[dict[str, str]]:
    return []


@app.post("/api/deals")
def create_deal() -> dict[str, str]:
    return {"status": "created"}
