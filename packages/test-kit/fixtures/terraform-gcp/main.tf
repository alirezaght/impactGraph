# PRD §42.2 fixture: a small GCP project — Cloud Run + Pub/Sub + Secret Manager IAM
# (awaiting the Epic 16 Terraform adapter). Parsed, never executed.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.30"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_cloud_run_service" "deals_api" {
  name     = "deals-api"
  location = var.region

  template {
    spec {
      containers {
        image = "gcr.io/${var.project_id}/deals-api:latest"

        env {
          name  = "DEAL_EVENTS_TOPIC"
          value = google_pubsub_topic.deal_events.name
        }
      }
    }
  }
}

resource "google_pubsub_topic" "deal_events" {
  name = "deal-events"
}

resource "google_pubsub_subscription" "deal_events_worker" {
  name  = "deal-events-worker"
  topic = google_pubsub_topic.deal_events.name

  ack_deadline_seconds = 20
}

resource "google_secret_manager_secret_iam_member" "deals_api_db_password" {
  secret_id = "db-password"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:deals-api@${var.project_id}.iam.gserviceaccount.com"
}

module "dead_letter" {
  source     = "./modules/dead-letter"
  topic_name = google_pubsub_topic.deal_events.name
}

# A module written in Terraform's JSON syntax. Calling it from HCL is ordinary Terraform, and the
# graph must not be able to tell which syntax a module was written in.
module "json_syntax" {
  source = "./modules/json-syntax"
}
