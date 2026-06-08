# Phase 0.3 Spike Notes

## Scrape (Python)

- `httpx` + `BeautifulSoup` parses `tgme_widget_message` widgets.
- Behavioral parity with Express: post IDs, forwarded metadata, pagination, soft-block detection.
- Tests use saved HTML fixtures under `backend/tests/fixtures/`.

## Gemini stream (Python)

- `google-genai` SDK supports `generate_content_stream`.
- Exposed as SSE from FastAPI `StreamingResponse`.
- API key server-side only.

## Tor

- `stem` for NEWNYM on control port 9051.
- Password from `TOR_CONTROL_PASSWORD` env, not request body.
- SOCKS5 proxy `socks5h://127.0.0.1:9050` for outbound requests.
