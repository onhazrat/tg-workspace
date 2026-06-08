# ADR-004: Job Runner

**Status:** Accepted

**Decision:** APScheduler in-process inside backend container for self-hosted single instance.

**Jobs:** auto-sync, embedding backfill, auto-summary, retention, translation batch.

**Alternative deferred:** Celery + Redis if horizontal scaling needed.
