package com.example.deals;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Field injection with no constructor, plus a scheduled task — the two Spring shapes the
 * constructor-injection path cannot show.
 */
@Component
public class DealExpiryJob {

    @Autowired
    private DealService dealService;

    @Scheduled(cron = "0 0 3 * * *")
    public void expireStaleDeals() {
        dealService.findAll();
    }
}
