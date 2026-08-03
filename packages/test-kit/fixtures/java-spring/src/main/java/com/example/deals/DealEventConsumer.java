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
 * Story 16.3 — the Spring Integration consumer shape, written the way Spring Cloud GCP's own
 * sample writes it. The whole chain is in one compilation unit, which is what makes it provable:
 * the adapter names the SUBSCRIPTION, `setOutputChannel` names the CHANNEL, and the
 * `@ServiceActivator` consumes that channel. The handler is declared ABOVE the bean that binds it,
 * on purpose — the adapter's channel pass has to be file-level, not top-to-bottom.
 */
@Configuration
public class DealEventConsumer {

    @ServiceActivator(inputChannel = "dealEventsChannel")
    public void onDealEvent(String payload) {
        System.out.println(payload);
    }

    /**
     * A second handler on a channel nothing binds to Pub/Sub. It must stay unlinked and warned
     * about, never attached to the only subscription in sight.
     */
    @ServiceActivator(inputChannel = "unboundChannel")
    public void onUnrelatedEvent(String payload) {
        System.out.println(payload);
    }

    @Bean
    public MessageChannel dealEventsChannel() {
        return new DirectChannel();
    }

    @Bean
    public PubSubInboundChannelAdapter dealEventsAdapter(
            @Qualifier("dealEventsChannel") MessageChannel inputChannel,
            PubSubTemplate pubSubTemplate) {
        PubSubInboundChannelAdapter adapter =
                new PubSubInboundChannelAdapter(pubSubTemplate, "deal-events-worker");
        adapter.setOutputChannel(inputChannel);
        return adapter;
    }
}
