variable "project_id" {
  description = "GCP project the fixture resources belong to."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run and Pub/Sub resources."
  type        = string
  default     = "europe-west3"
}

variable "enable_audit" {
  description = "Whether the audit topic is created — a count this adapter cannot resolve."
  type        = bool
  default     = false
}
