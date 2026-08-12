# Admin traffic does NOT reach newsletter-service directly. It goes through the aggregator,
# which is where the environment has to be set — and where it is not.

variable "NEWSLETTER_SERVICE_URL" {
  type = string
}

locals {
  _agg = {
    newsletter = google_cloud_run_v2_service.aggregator.uri
  }

  frontend_service_urls = {
    newsletter = local._agg.newsletter
  }
}

resource "google_cloud_run_v2_service" "aggregator" {
  name     = "aggregator"
  location = "europe-west3"

  template {
    containers {
      image = "gcr.io/example/aggregator:latest"

      env {
        name  = "ADMIN_BASE_URL"
        value = "https://admin.example.com"
      }
    }
  }
}

resource "google_cloud_run_v2_service" "newsletter_service" {
  name     = "newsletter-service"
  location = "europe-west3"

  template {
    containers {
      image = "gcr.io/example/newsletter-service:latest"

      env {
        name  = "SENDGRID_TEMPLATE_IDS_JSON"
        value = var.NEWSLETTER_SERVICE_URL
      }
    }
  }
}
