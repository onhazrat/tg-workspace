import { scopedStorage } from "@/lib/storage/scoped"

/**
 * The model last chosen for each AI Key.
 *
 * One Key reaches one provider's catalogue, so "which model" is really a
 * question about a *pair*. An account holding a cheap OpenRouter Key and a
 * Gemini Key had to retype the model every time it switched, because
 * `selectedModel` is a single setting and switching Keys left the previous
 * provider's id in the box — pointing at an endpoint that has never heard of
 * it, which is the exact state the unlisted-model warning now flags.
 *
 * **In browser storage beside the selection itself**, for the reason
 * `selection.ts` gives at length: this is a per-device convenience, the server
 * already stores the durable answer on each Artifact (`Summary.extra.aiKeyId`),
 * and a settings row would give two answers to one question. `scopedStorage`
 * namespaces it per acting account.
 *
 * One JSON object rather than a key per credential, so pruning is a single
 * write and a corrupt value costs the whole map rather than leaking a partial
 * one. Every accessor swallows its own errors: these run inside render paths
 * and an effect, where a throw from a blocked storage API would take the page
 * with it.
 */
const KEY_MODELS = "ai_key_models"

function readMap(): Record<string, string> {
  try {
    const raw = scopedStorage.getItem(KEY_MODELS)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {}
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

function writeMap(map: Record<string, string>): void {
  try {
    scopedStorage.setItem(KEY_MODELS, JSON.stringify(map))
  } catch {
    // A full or blocked store loses the convenience, never the run.
  }
}

/** The model last chosen for this Key, or `null` if it has none yet. */
export function modelForKey(keyId: string | null): string | null {
  if (!keyId) return null
  const remembered = readMap()[keyId]
  return typeof remembered === "string" && remembered ? remembered : null
}

/** Record a deliberate model choice against the Key that will pay for it. */
export function rememberModelForKey(keyId: string | null, model: string): void {
  const value = model.trim()
  if (!keyId || !value) return
  const map = readMap()
  // Compared before writing, because this runs on every commit and the common
  // one re-picks what was already there.
  if (map[keyId] === value) return
  map[keyId] = value
  writeMap(map)
}

/**
 * Drop entries for Keys the account no longer holds.
 *
 * Called from `reconcileAiKeySelection`, which is already the one place that
 * knows which ids are live. Without it the map only ever grows, and a Key id
 * reissued to a different provider would inherit a model it cannot serve.
 */
export function forgetModelsForMissingKeys(ids: readonly string[]): void {
  const map = readMap()
  const live: Record<string, string> = {}
  for (const [id, model] of Object.entries(map)) {
    if (ids.includes(id)) live[id] = model
  }
  if (Object.keys(live).length !== Object.keys(map).length) writeMap(live)
}
