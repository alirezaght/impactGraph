"""SQLAlchemy-style model whose column types are stated in code (ADR-0020 §3).

`id = Column(UUID, primary_key=True)` is the exact declaration the UUID/SQL near-miss needed
indexed: a plan comparing `listing.id` against string-bound parameters can only be questioned if
this line's type survives into the graph.
"""

from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Listing(Base):
    __tablename__ = "listings"

    id = Column(UUID, primary_key=True)
    title = Column(String(120), nullable=False)
