from fastapi import BackgroundTasks, FastAPI

from app.models import Deal
from app.routers.deals import router as deals_router
from app.routers.health import router as health_router

app = FastAPI(title="fastapi-app")

app.include_router(deals_router, prefix="/deals")
app.include_router(health_router)


def notify_watchers(deal: Deal) -> None:
    """Runs after the response is sent — a background task, not an endpoint."""
    _ = deal.name


@app.post("/deals/{deal_id}/publish")
def publish_deal(deal_id: str, background_tasks: BackgroundTasks) -> dict[str, str]:
    deal = Deal(id=deal_id, name="published", visibility="public")
    background_tasks.add_task(notify_watchers, deal)
    return {"status": "queued"}
