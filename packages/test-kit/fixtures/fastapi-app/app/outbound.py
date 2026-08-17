"""The SqlOutboundQueueRepository.list_rows member-resolution case.

`list_rows` is declared on a mixin and reaches the repository class only through inheritance.
The golden pins the facts the assumption check depends on: the mixin's method survives as a
CONTAINS member, and the subclass carries a real EXTENDS edge to the mixin — so a specification
asserting `SqlOutboundQueueRepository.list_rows` is verifiable, never declared nonexistent.
"""


class OutboundAuditReadsMixin:
    def list_rows(self, limit):
        return []


class SqlOutboundQueueRepository(OutboundAuditReadsMixin):
    def save(self, row):
        return row
