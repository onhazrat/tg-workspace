# ADR-007: Tor Deployment

**Status:** Accepted

**Decision:** Hybrid network config. Tor control password in server env only. Optional Tor sidecar in Docker Compose. UI may trigger NEWNYM/restart via API without sending passwords from browser.

**Spike result:** Python `stem` for control; httpx + socks proxy for requests.
