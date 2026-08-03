package com.example.deals;

import java.util.List;

import org.springframework.stereotype.Service;

@Service
public class DealService {

    private final DealRepository dealRepository;
    private final DealAuditLog auditLog;

    public DealService(DealRepository dealRepository, DealAuditLog auditLog) {
        this.dealRepository = dealRepository;
        this.auditLog = auditLog;
    }

    public List<String> findAll() {
        return dealRepository.loadAll();
    }

    public String findById(String id) {
        return dealRepository.load(id);
    }

    public String create(String name) {
        return dealRepository.save(name);
    }

    /**
     * `entry` names two different collaborators in two sibling blocks. Java scopes each of them to
     * its own block, so `entry.record(...)` is a call on the audit log and `entry.load(...)` is a
     * call on the repository — which is only true of an adapter that resolves a receiver at the
     * position of the call rather than from a flattened per-method map.
     */
    public String describe(String id) {
        if (id.isEmpty()) {
            DealAuditLog entry = auditLog;
            return entry.record("describe called without an id");
        }
        DealRepository entry = dealRepository;
        return entry.load(id);
    }
}
