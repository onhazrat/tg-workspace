/**
 * The exportable/clearable server tables, in the order the backend reports them.
 *
 * Mirrors `_TABLE_SECTIONS` in `backend/app/services/stats.py`, which is what
 * `GET /data/table-sizes` enumerates and what `DELETE /data/tables/{name}`
 * accepts. Kept as a constant rather than fetched because the command palette
 * needs the list synchronously to build its entity flow, before any request has
 * been made.
 *
 * Before A4 this was `INDEXEDDB_STORE_NAMES` — the browser mirror's stores.
 * Same idea, real database.
 */
export const SERVER_TABLE_NAMES = [
  "setting_groups",
  "channels",
  "posts",
  "summaries",
  "bot_credentials",
  "chat_destinations",
  "publish_logs",
  "sync_logs",
  "llm_logs",
  "embedding_logs",
  "network_logs",
  "embeddings",
  "translations",
] as const
