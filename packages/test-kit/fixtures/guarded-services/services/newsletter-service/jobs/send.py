"""The allowlisted batch send job. It may read profile data over HTTP."""
import httpx

PROFILE_URL = "http://user-profile-service/internal/preferences"


def load_preferences(subscriber_id: str) -> dict:
    return httpx.get(f"{PROFILE_URL}/{subscriber_id}").json()
