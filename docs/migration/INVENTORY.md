# TG-Summarizer Migration Inventory

## IndexedDB stores (`src/lib/db.ts`)

| Store | Key | Active |
|-------|-----|--------|
| `posts` | `[channelName, id]` | Yes |
| `channels` | `id` | Yes |
| `summaries` | `id` | Yes |
| `bot_credentials` | `id` | Yes |
| `chat_destinations` | `id` | Yes |
| `publish_logs` | `id` | Yes |
| `sync_logs` | `id` | Yes |
| `llm_logs` | `id` | Yes |
| `embedding_logs` | `id` | Yes |
| `network_logs` | `id` | Yes |
| `embeddings` | `id` | Yes |
| `translations` | `id` | Yes |
| `bots` (legacy) | `id` | Migrated to `bot_credentials` |

Settings live in `localStorage` via `SettingsContext`, not IndexedDB.

## Express API routes (`server/server.ts`)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/test-proxy` | Test proxy → ipify |
| GET | `/api/proxy-health` | Bad proxy cooldown list |
| GET | `/api/tor-status` | Tor port status |
| GET | `/api/tor-ip` | IP via local Tor |
| POST | `/api/tor-restart` | Restart Tor process |
| POST | `/api/tor-new-identity` | Tor NEWNYM |
| POST | `/api/bot-info` | Telegram Bot API proxy |
| POST | `/api/publish` | Chunked sendMessage |
| POST | `/api/channel-info` | Channel metadata scrape |
| POST | `/api/scrape` | Post pagination scrape |

FastAPI equivalents: `/api/v1/network/*`, `/api/v1/telegram/*` plus legacy `/api/*` aliases.

## React contexts

| Context | Stays UI | Moves to API |
|---------|----------|--------------|
| `UIContext` | Yes | — |
| `SettingsContext` | Theme, RTL | Network/AI settings → server (Phase 3) |
| `DataContext` | View state | Persistence → server + cache |
| `ScraperContext` | Filters, queue UI | Scrape orchestration → server jobs (Phase 4) |
| `AIContext` | Streaming display | LLM calls → server (Phase 2) |
| `ChatContext` | Message UI | Chat → server (Phase 2) |
| `RAGContext` | Search UI | Embeddings/search → server (Phase 5) |
| `TranslationContext` | — | Translation → server (Phase 2/4) |

## Background jobs (browser today)

| Job | Location | Interval |
|-----|----------|----------|
| Auto-sync channels | `App.tsx` | 60s check |
| Data retention | `App.tsx` | 6h |
| Embedding backfill | `RAGContext.tsx` | 60s |
| Auto-regenerate summaries | `AIContext.tsx` | 60s |
| Translation batch | `TranslationContext.tsx` | 1s debounce |
| Proxy health poll | `SettingsView.tsx` | 10s |
| Tor status poll | `SettingsView.tsx` | 10s |

## Direct `/api/*` callers (need `frontend/src/api/`)

- `src/services/telegram.ts`
- `src/components/SettingsView.tsx`
- `src/components/BotManagement.tsx`
- `src/components/ChannelGrid.tsx`
- `src/components/NetworkTelemetry.tsx`
- `src/contexts/ScraperContext.tsx`

## Tests as specification

- `tests/test-scrape*.ts` — HTML parsing behavior
- `src/lib/db.test.ts` — IndexedDB operations
- `src/workers/dbWorker.test.ts` — export/import
