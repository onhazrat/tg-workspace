# Secrets Matrix

| Secret | Today | After migration |
|--------|-------|-----------------|
| `GEMINI_API_KEY` | Vite bundle (`vite.config.ts`) | Server env only (`backend` settings) |
| Bot tokens | IndexedDB, sent per request | Postgres encrypted; server calls Telegram API |
| Tor control password | `localStorage`, request body | Server env only; never in browser |
| Proxy URLs | `localStorage` | Per-user `proxyUrls` in Postgres (`AppSetting` key `network`, scoped by `user_id`); `DEFAULT_PROXY_URLS` env is fallback only when user list is empty; credentials redacted in logs |
| `SECRET_KEY` / JWT | N/A | Template JWT + optional `API_KEY` for light auth |
| Postgres password | N/A | Docker `.env` |

## Migration requirements

1. Remove `process.env.GEMINI_API_KEY` from `frontend/vite.config.ts`.
2. Stop sending `torControlPassword` from frontend scrape/publish requests.
3. Encrypt `BotCredential.token` at rest in PostgreSQL.
4. Never log full bot tokens or API keys.
