"""Newsletter service configuration."""
import json
import os


class Settings:
    # Present and truthy, and yet it means "no template is configured".
    SENDGRID_TEMPLATE_IDS_JSON = "{}"

    def sendgrid_template_ids(self) -> dict:
        raw = os.environ.get("SENDGRID_TEMPLATE_IDS_JSON", self.SENDGRID_TEMPLATE_IDS_JSON)
        return json.loads(raw)
