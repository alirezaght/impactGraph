package com.example.deals;

import com.google.cloud.spring.pubsub.core.PubSubTemplate;
import com.google.cloud.spring.pubsub.integration.inbound.PubSubInboundChannelAdapter;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.integration.annotation.ServiceActivator;
import org.springframework.integration.channel.DirectChannel;
import org.springframework.messaging.MessageChannel;

/**
 * The THIRD language on the same two Pub/Sub resources (Story 16.3, PRD §C13).
 *
 * `deal-events` and `deal-events-worker` are the topic and subscription ../../../../../infra/main.tf
 * declares, and the ones ../../../../../api/app/events.py (Python) and
 * ../../../../../worker/src/deal-publisher.ts (TypeScript) already use. Nothing here names
 * Terraform, Python or TypeScript — the resource names are the only thing all four share, which is
 * exactly what the cross-stack correspondence rests on.
 *
 * The point of this file in the golden is that it adds NO new topic or subscription node: a Java
 * publisher and a Python consumer of `deal-events` must be ONE node, or multi-stack analysis is
 * four separate analyses wearing a trench coat.
 */
@Configuration
public class DealEventBridge {

    private final PubSubTemplate pubSubTemplate;

    public DealEventBridge(PubSubTemplate pubSubTemplate) {
        this.pubSubTemplate = pubSubTemplate;
    }

    public void republishDeal(String payload) {
        pubSubTemplate.publish("deal-events", payload);
    }

    @ServiceActivator(inputChannel = "dealEventsChannel")
    public void onDealEvent(String payload) {
        republishDeal(payload);
    }

    @Bean
    public MessageChannel dealEventsChannel() {
        return new DirectChannel();
    }

    @Bean
    public PubSubInboundChannelAdapter dealEventsAdapter(
            @Qualifier("dealEventsChannel") MessageChannel inputChannel,
            PubSubTemplate template) {
        PubSubInboundChannelAdapter adapter =
                new PubSubInboundChannelAdapter(template, "deal-events-worker");
        adapter.setOutputChannel(inputChannel);
        return adapter;
    }
}
