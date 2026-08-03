from fastapi import APIRouter

# Renamed on purpose (epic-16 line 140): the module defines `Deal`, this file calls it
# `DealSchema`. Renaming a binding must not change the graph — the CALLS edges below still have to
# land on `app/models.py#Deal`. Before the assembler translated a local alias back to the exported
# name it looked `DealSchema` up in that module's export table, found nothing, and dropped them.
from app.models import Deal as DealSchema

router = APIRouter(tags=["deals"])


@router.get("/")
def list_deals() -> list[DealSchema]:
    return [DealSchema(id="d1", name="Project Alpha")]


@router.get("/{deal_id}")
def get_deal(deal_id: str) -> DealSchema:
    return DealSchema(id=deal_id, name="Project Alpha")


@router.post("/")
def create_deal(deal: DealSchema) -> DealSchema:
    return deal
