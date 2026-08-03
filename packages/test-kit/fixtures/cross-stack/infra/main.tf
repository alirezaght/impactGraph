# The infrastructure half. Every `name` here is a plain literal on purpose: a name this file does
# not state literally is a name the adapter is not allowed to know (PRD §35). Parsed, never run.

resource "google_cloud_run_v2_service" "web" {
  name     = "deals-web"
  location = "europe-west3"
}

resource "google_cloud_run_v2_job" "worker" {
  name     = "deals-worker"
  location = "europe-west3"

  template {
    template {
      containers {
        # The other half of `process.env.DEAL_EVENTS_TOPIC` in worker/src/deal-publisher.ts. The
        # value REFERENCES a topic this file declares, so both halves are stated and the two join.
        env {
          name  = "DEAL_EVENTS_TOPIC"
          value = google_pubsub_topic.deal_events.name
        }

        # Deliberately a literal, not a reference. It happens to spell a real topic's name, and it
        # must still bind nothing: a string is not a resource, and matching on the spelling would
        # be the "looks like a topic" guess this whole correspondence refuses.
        env {
          name  = "LEGACY_TOPIC"
          value = "deal-events"
        }
      }
    }
  }
}

resource "google_cloud_run_v2_service" "unmatched" {
  name     = "no-such-package"
  location = "europe-west3"
}

resource "google_pubsub_topic" "deal_events" {
  name = "deal-events"
}

resource "google_pubsub_subscription" "deal_events_worker" {
  name  = "deal-events-worker"
  topic = google_pubsub_topic.deal_events.name
}
