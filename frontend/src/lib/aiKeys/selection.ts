import { scopedStorage } from "@/lib/storage/scoped"

/**
 * Which AI Key pays for the next Artifact, remembered per account.
 *
 * **In browser storage rather than in a settings row or on the server**, which
 * is the ticket's choice and not an accident: it is a per-device convenience
 * like the collapsed-section state beside it, and the server already has the
 * only version that has to be durable — `Summary.extra.aiKeyId`, which BYOK-03
 * writes for the unattended path. Putting the live selection in a settings row
 * as well would give two answers to "which key" and make them drift.
 *
 * `scopedStorage` namespaces it under the acting account, so a View-as session
 * and the Owner do not share a selection.
 *
 * An id that no longer names a Key is harmless: `resolve_ai_key` answers 404
 * exactly as it does for another account's id, and the client falls back to
 * sending nothing, which resolves the account's own most recent working Key.
 */
const SELECTED_AI_KEY = "selected_ai_key"

export function selectedAiKeyId(): string | null {
  return scopedStorage.getItem(SELECTED_AI_KEY)
}

export function rememberAiKeyId(id: string | null): void {
  if (id) {
    scopedStorage.setItem(SELECTED_AI_KEY, id)
  } else {
    scopedStorage.removeItem(SELECTED_AI_KEY)
  }
}
