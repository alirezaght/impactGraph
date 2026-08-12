#!/usr/bin/env python3
"""Fail the build when a service calls a peer service over HTTP.

Peer-to-peer HTTP between services is forbidden: it couples deploys and hides failure
modes. The newsletter send job is the one exception, because it must read profile data
in a batch window where the event stream is not available.
"""
import re
import sys
from pathlib import Path

SERVICE_DIRS = "services"

ALLOWLIST = [
    "services/newsletter-service/jobs/send.py",
]

PEER_HTTP = re.compile(r"https?://[a-z0-9-]+-service")


def main() -> int:
    failures = []
    for path in Path(SERVICE_DIRS).rglob("*.py"):
        if str(path) in ALLOWLIST:
            continue
        if PEER_HTTP.search(path.read_text()):
            failures.append(str(path))
    for failure in failures:
        print(f"peer-service HTTP call in {failure}")
    if failures:
        sys.exit(1)
    return 0


if __name__ == "__main__":
    main()
