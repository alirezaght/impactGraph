# PRD §42.2 fixture, Story 16.1 depth: the multiplicity and data-source surface, in one file so a
# golden can pin all of it. Parsed, never applied — `count` is read, never evaluated (§35).

# A data source IS declared here, so a resource that reads it has a real dependency edge.
data "google_secret_manager_secret" "db_password" {
  secret_id = "db-password"
}

resource "google_secret_manager_secret_iam_member" "worker_db_password" {
  secret_id = data.google_secret_manager_secret.db_password.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:worker@${var.project_id}.iam.gserviceaccount.com"
}

# A literal count: three objects exist, so three nodes exist.
resource "google_pubsub_topic" "shard" {
  count = 3

  name = "deal-events-shard-${count.index}"
}

# A splat names the whole set, which is exactly what the expanded instances are.
output "shard_topic_names" {
  value = google_pubsub_topic.shard[*].name
}

# A count that is an expression: unknowable without running Terraform, so one node and a warning.
resource "google_pubsub_topic" "audit" {
  count = var.enable_audit ? 1 : 0

  name = "deal-audit"
}

# `for_each` keys are never evaluated either — same honest degradation.
resource "google_service_account" "worker" {
  for_each = toset(["ingest", "export"])

  account_id = each.key
}
