from pydantic import BaseModel, Field


class Deal(BaseModel):
    """The single domain model the fixture's endpoints exchange."""

    id: str
    name: str = Field(min_length=1)
    visibility: str = "private"
