"""One Request with no network under it, for stubs that stand in for a fetch."""

from datetime import UTC, datetime

from app.core.request_recording import page_for_fetch


def answered_request() -> None:
    """Record one answered web view attempt into whatever work is open.

    What `fetch_with_retry` records for a page Telegram served, so the open
    Accounted work charges and tallies it by the one charge rule (ADR-041).
    """
    page_for_fetch(media=False).record(
        at=datetime.now(UTC),
        latency_ms=1,
        lane="direct",
        web_view=True,
        cause=None,
        error_code=None,
        answered=True,
    )
