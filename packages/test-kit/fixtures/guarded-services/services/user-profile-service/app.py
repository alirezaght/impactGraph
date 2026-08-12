"""The user profile service."""


def preferences(subscriber_id: str) -> dict:
    return {"subscriber": subscriber_id, "channel": "email"}
