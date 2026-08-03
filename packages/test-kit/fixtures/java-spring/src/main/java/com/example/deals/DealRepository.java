package com.example.deals;

import java.util.List;

import org.springframework.stereotype.Repository;

@Repository
public class DealRepository {

    public List<String> loadAll() {
        return List.of("Project Alpha");
    }

    public String load(String id) {
        return "deal-" + id;
    }

    public String save(String name) {
        return name;
    }
}
