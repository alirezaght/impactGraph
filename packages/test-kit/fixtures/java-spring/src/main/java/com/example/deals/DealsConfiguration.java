package com.example.deals;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DealsConfiguration {

    @Bean
    public DealRepository dealRepository() {
        return new DealRepository();
    }

    @Bean("dealArchive")
    public DealRepository archiveRepository() {
        return new DealRepository();
    }
}
