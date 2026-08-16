"""Test database: the suite runs on SQLite, production runs Postgres."""
import os

DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "sqlite:///:memory:")
