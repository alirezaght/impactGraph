"""Raw SQL that handles a UUID array binding correctly (ADR-0020 §4).

The `= ANY(CAST(:ids AS uuid[]))` literal is the analogous, correctly-handled SQL a
type-sensitive-comparison finding should point a reader at: same operator, explicit cast.
"""


async def load_listings_by_ids(session, listing_ids):
    result = await session.execute(
        "SELECT id, title FROM listings WHERE listings.id = ANY(CAST(:ids AS uuid[]))",
        {"ids": listing_ids},
    )
    return result.fetchall()
