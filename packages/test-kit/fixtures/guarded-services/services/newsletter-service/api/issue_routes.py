"""Issue rendering routes for the newsletter service."""
from newsletter_service.settings import Settings


def render_issue(issue_id: str) -> dict:
    settings = Settings()
    return {"issue": issue_id, "templates": settings.sendgrid_template_ids()}
