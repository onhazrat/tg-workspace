import { useSyncExternalStore } from "react"

import type { AiKey } from "@/lib/aiKeys/store"
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

/**
 * Subscribers to the selection, so a change re-renders everything that reads it.
 *
 * The selection used to be read three ways — a plain `selectedAiKeyId()` call
 * in `withAiKey`, another in `useAiModels`, and a `useState` shadow copy inside
 * `RunSettingsBar` — and only the third re-rendered anything. That held while
 * the only reader on screen was the chooser itself and its own child. It stops
 * holding now that three run buttons in three separate subtrees gate on whether
 * a Key is selected: `TagConfig` is not below the bar, so a bar-local `useState`
 * could never have reached it.
 */
const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

export function selectedAiKeyId(): string | null {
  return scopedStorage.getItem(SELECTED_AI_KEY)
}

export function rememberAiKeyId(id: string | null): void {
  if (id) {
    scopedStorage.setItem(SELECTED_AI_KEY, id)
  } else {
    scopedStorage.removeItem(SELECTED_AI_KEY)
  }
  for (const notify of listeners) notify()
}

/**
 * The stored selection, or `null`, re-rendering on every change.
 *
 * **Not the hook components use** — that is `useSelectedAiKeyId` in
 * `hooks/useAiKeys.ts`, which mounts the query that fills this in. Reading the
 * store alone answers `null` on any screen that never fetched the Key list, and
 * three of the four `ModelCombo` call sites are on such screens.
 *
 * `useSyncExternalStore` rather than a context: the writer is a plain function
 * (`rememberAiKeyId`) called from `api/ai.ts`'s neighbourhood and from the
 * reconcile below, neither of which sits under a provider — and wrapping the
 * app in one more provider to publish a single string is the heavier answer to
 * a problem React ships a hook for.
 *
 * **`null` means "no Key at all" in practice**, not "holds Keys, picked none":
 * `reconcileAiKeySelection` selects the first whenever the list is non-empty
 * and nothing is remembered. Callers gating on a Key being selected therefore
 * gate on the account having one, which is the same condition said honestly —
 * a bar whose select shows a Key beside a disabled run button would read as a
 * bug, not as a prompt.
 */
export function useStoredAiKeyId(): string | null {
  return useSyncExternalStore(subscribe, selectedAiKeyId, () => null)
}

/**
 * Which Key the server would choose when the client names none.
 *
 * `resolve_ai_key` takes `(validated or rows)[0]` from rows already sorted
 * newest write first, so this is that rule restated — and it has to be, because
 * writing the selection through means the client now *names* a Key on every
 * request where it used to stay silent. Picking `ids[0]` instead would quietly
 * override the server on the one case the server's rule exists for: a Key saved
 * today whose provider check failed sorts ahead of a working Key saved last
 * week, and every run would go to the broken one.
 */
function serverPreferred(keys: readonly AiKey[]): string | null {
  const validated = keys.find((k) => k.lastValidated)
  return (validated ?? keys[0])?.id ?? null
}

/**
 * Reconcile the remembered id against the Keys that actually exist.
 *
 * Two halves, and both run wherever the list loads rather than wherever a
 * chooser happens to be mounted.
 *
 * **Forget an id that names nothing.** Without it the fallback above is a
 * comment rather than behaviour, and the failure is total: delete the Key you
 * had selected and every summary, chat and tag request sends its id for ever,
 * because `withAiKey` reads storage and cannot see the list.
 *
 * **Select the Key the server would have picked when nothing is remembered.**
 * The bar used to show
 * `aiKeys[0]` as a *display* fallback while `withAiKey` sent nothing, so an
 * account holding two Keys saw the chip name one and had the server pick the
 * other — `resolve_ai_key`'s "most recent working Key" is not "the first in
 * this list". Writing the selection through is what makes the chip and the wire
 * one answer. It also gives adding a Key its rule for free: with none, the new
 * Key is the only Key and becomes the selection; with one already chosen,
 * there is nothing to write and the choice stands.
 */
export function reconcileAiKeySelection(keys: readonly AiKey[]): void {
  const remembered = selectedAiKeyId()
  if (remembered && keys.some((k) => k.id === remembered)) return
  // Deliberately not an early return on the forget: deleting the selected Key
  // while another remains has to land on that other Key, or the account holds
  // a Key, shows it in the chip, and finds every run button disabled until it
  // reloads.
  rememberAiKeyId(serverPreferred(keys))
}
