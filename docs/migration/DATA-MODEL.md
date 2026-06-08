# SQL Schema Draft (from `types.ts`)

## Core entities

- **channels** — `id` PK, metadata, `last_updated`, `is_frozen`, tags JSON
- **posts** — composite `(channel_name, id)` PK, text, date, timestamp, forwarded fields
- **summaries** — `id` PK, text, channels JSON, date range, model, config JSON
- **bot_credentials** — `id` PK, `token_encrypted`, username, metadata
- **chat_destinations** — `id` PK, name, chat_id
- **post_embeddings** — `id` PK, vector JSON, provider, model, dimensions
- **post_translations** — composite id, language, text
- **app_settings** — key/value JSON (network defaults, sync intervals)

## Log tables

- `publish_logs`, `sync_logs`, `llm_logs`, `embedding_logs`, `network_logs`

## Sync metadata

- `updated_at` on all mutable tables for cache invalidation
- Optional `user_id` column reserved for future multi-user
