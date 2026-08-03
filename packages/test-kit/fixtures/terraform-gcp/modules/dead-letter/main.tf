resource "google_pubsub_topic" "dead_letter" {
  name = "${var.topic_name}-dead-letter"
}
