package com.example.deals;

import org.springframework.stereotype.Component;

/**
 * A second collaborator of DealService, so that a same-named local in a sibling block has a
 * DIFFERENT declared type to resolve to (see DealService.describe).
 */
@Component
public class DealAuditLog {

    public String record(String message) {
        return message;
    }
}
