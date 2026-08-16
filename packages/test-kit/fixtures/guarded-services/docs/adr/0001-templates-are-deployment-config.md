# ADR-0001: Newsletter templates are deployment configuration

Status: Accepted

## Decision

Template identifiers used by services/newsletter-service are supplied through deployment
configuration in infra, never hardcoded in application code. Rotating a template must be a
configuration change, not a release.

## Consequences

Code under services/newsletter-service reads template identifiers from the environment and
treats an absent value as a hard failure at send time.
