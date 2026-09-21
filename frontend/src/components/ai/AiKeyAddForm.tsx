import { Plus } from "lucide-react"
import type React from "react"
import { useState } from "react"

import { TgButton } from "@/components/ui/tg-button"
import { TgInput } from "@/components/ui/tg-input"
import { useRefreshAiKeys } from "@/hooks/useAiKeys"
import { saveAiKey } from "@/lib/aiKeys/store"

/**
 * Save a new AI Key, from wherever somebody needs one.
 *
 * Extracted from `AIKeysPanel`, which was the only place an Account could add a
 * Key — and the wrong one, because the error that tells you a Key is missing is
 * raised by the run button two tabs away. The Action tab's own bar renders this
 * in a dialog now, so the fix is reachable from the screen that reports the
 * problem.
 *
 * **A component rather than a hook**, which is the whole point: the state is
 * four fields, and the markup is a conditional base-URL input that only exists
 * for one of the two provider kinds. A `useAiKeyForm()` hook would have shared
 * the validation and left both call sites hand-rendering that condition — two
 * copies of the half most likely to drift.
 *
 * Two provider kinds and only two (BYOK-02). "OpenAI-compatible" is one kind
 * rather than a family — OpenRouter, Groq, Together, DeepSeek, Mistral, a local
 * Ollama and vLLM are the same API at different addresses — so what tells them
 * apart is the base URL, and the field appears only for that kind. Gemini needs
 * none and showing it an empty one would invite somebody to fill it in.
 *
 * `onSaved` fires only when the provider check passed. A Key that saved without
 * verifying still exists and is still used, but the message saying so is inside
 * this form — so a caller that closes a dialog on `onSaved` throws it away, and
 * the one state where there is something to read is the one where it stays.
 */
export const AiKeyAddForm: React.FC<{ onSaved?: () => void }> = ({
  onSaved,
}) => {
  const refresh = useRefreshAiKeys()
  const [label, setLabel] = useState("")
  const [secret, setSecret] = useState("")
  const [provider, setProvider] = useState("gemini")
  const [baseUrl, setBaseUrl] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addKey = async () => {
    if (!secret.trim()) {
      setError("Paste a provider API key first.")
      return
    }
    if (provider === "openai_compatible" && !baseUrl.trim()) {
      setError("An OpenAI-compatible key needs a base URL.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await saveAiKey({
        id: crypto.randomUUID(),
        label: label.trim() || "My key",
        key: secret.trim(),
        provider,
        baseUrl: baseUrl.trim() || null,
      })
      // The row is stored and used either way; only the message changes. A
      // failed check does not mean a bad key — the provider may simply have
      // been unreachable — so this says what happened rather than passing a
      // verdict the check cannot actually reach.
      if (!saved.validated) {
        setError(
          "Saved, but we could not verify it with the provider just now. " +
            "It will still be used; check the key if runs start failing.",
        )
      }
      setLabel("")
      setSecret("")
      setBaseUrl("")
      // Before `onSaved`, so a caller that closes on it closes over a list that
      // already names the new Key. `reconcileAiKeySelection` runs inside this
      // refetch and is what selects the Key when it is the account's first.
      await refresh()
      if (saved.validated) onSaved?.()
    } catch {
      setError("Could not save that key.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <select
        aria-label="Provider"
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
        className="w-full bg-app-card border border-app-ink/10 px-4 py-3 text-[11px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30"
      >
        <option value="gemini">GOOGLE GEMINI</option>
        <option value="openai_compatible">OPENAI-COMPATIBLE</option>
      </select>
      {provider === "openai_compatible" && (
        <TgInput
          type="text"
          placeholder="BASE URL (E.G. HTTPS://OPENROUTER.AI/API/V1)"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      )}
      <TgInput
        type="password"
        placeholder="PROVIDER API KEY"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
      />
      <TgInput
        type="text"
        placeholder="LABEL (E.G. WORK KEY)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <TgButton
        type="button"
        variant="primary"
        size="lg"
        onClick={addKey}
        loading={saving}
        loadingLabel="Checking…"
        className="w-full"
      >
        <Plus size={14} /> Save Key
      </TgButton>
      {error && <p className="text-[10px] font-mono text-red-500">{error}</p>}
    </div>
  )
}
