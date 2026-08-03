package com.example.deals;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/deals")
public class DealController {

    private final DealService dealService;

    public DealController(DealService dealService) {
        this.dealService = dealService;
    }

    @GetMapping
    public List<String> listDeals() {
        return dealService.findAll();
    }

    @GetMapping("/{id}")
    public String getDeal(@PathVariable String id) {
        return dealService.findById(id);
    }

    @PostMapping
    public String createDeal(@RequestBody String name) {
        return dealService.create(name);
    }
}
