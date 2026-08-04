# The infrastructure half. Nothing in the code names these resources and nothing here names a file:
# the topic name and the subscription's push endpoint are the only shared facts.
resource "google_pubsub_topic" "notification_events" {
  name = "notification-events"
}

resource "google_pubsub_subscription" "notification_push" {
  name  = "notification-push"
  topic = google_pubsub_topic.notification_events.name

  push_config {
    push_endpoint = "https://notification-service.example.com/pubsub/notifications"
  }
}

resource "google_cloud_run_service" "notification_service" {
  name     = "notification-service"
  location = "europe-west3"
}
