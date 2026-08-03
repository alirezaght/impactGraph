"""The consumer half of Story 16.3, in the other language of this multi-stack system.

`deal-events` and `deal-events-worker` are the topic and subscription ../../infra/main.tf
declares. This module states the names; it states nothing about Terraform.
"""

from google.cloud import pubsub_v1

PROJECT = "deals"

publisher = pubsub_v1.PublisherClient()
subscriber = pubsub_v1.SubscriberClient()

deal_events = publisher.topic_path(PROJECT, "deal-events")
worker_subscription = subscriber.subscription_path(PROJECT, "deal-events-worker")


def publish_deal(payload: bytes) -> None:
    publisher.publish(deal_events, payload)


def consume_deals() -> None:
    subscriber.subscribe(worker_subscription, callback=handle_message)


def handle_message(message) -> None:
    message.ack()
