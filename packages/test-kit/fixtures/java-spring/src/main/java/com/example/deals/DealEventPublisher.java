package com.example.deals;

import com.google.cloud.spring.pubsub.core.PubSubTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Story 16.3 — the Spring Cloud GCP publisher shape, and the two ways a name can be non-literal.
 * `deal-events` is a literal this file states. `eventsTopic` is not, but its `@Value` key IS stated
 * by this module's application.yml, so it resolves. `configuredTopic`'s key is stated nowhere, so
 * it resolves to nothing — the difference between the two is the whole point of this fixture.
 */
@Service
public class DealEventPublisher {

    private final PubSubTemplate pubSubTemplate;

    @Value("${deals.audit-topic}")
    private String configuredTopic;

    @Value("${deals.events-topic}")
    private String eventsTopic;

    public DealEventPublisher(PubSubTemplate pubSubTemplate) {
        this.pubSubTemplate = pubSubTemplate;
    }

    public void publishDealCreated(String payload) {
        this.pubSubTemplate.publish("deal-events", payload);
    }

    /**
     * Still undetectable, and for the right reason now: `deals.audit-topic` appears in no
     * application.yml in this module, so the repository states no value for it anywhere. The
     * adapter records the identifier and a warning; nothing resolves (PRD §35).
     */
    public void publishAuditEvent(String payload) {
        pubSubTemplate.publish(configuredTopic, payload);
    }

    /**
     * Resolvable: `deals.events-topic` IS stated, by src/main/resources/application.yml in this
     * module. The topic node it produces cites both sites — this annotation and that line.
     */
    public void publishConfiguredEvent(String payload) {
        pubSubTemplate.publish(eventsTopic, payload);
    }
}
