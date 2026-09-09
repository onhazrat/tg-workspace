import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Plus,
  Trash2,
} from "lucide-react"
import type React from "react"
import { useState } from "react"

import { RelativeTime } from "@/components/RelativeTime"
import { TgButton } from "@/components/ui/tg-button"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { TgInput } from "@/components/ui/tg-input"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import { useAiKeys, useRefreshAiKeys } from "@/hooks/useAiKeys"
import { deleteAiKey, saveAiKey } from "@/lib/aiKeys/store"

/**
 * The account's own AI Keys (BYOK-01), mirroring `BotCredentialsPanel`.
 *
 * The two panels are the same shape because the two objects are: a secret you
 * paste once, stored server-side, never shown back. What differs is the status
 * line — a bot token is validated on demand by a button, and an AI Key is
 * validated on save and then only by a call somebody was making anyway. There
 * is deliberately no re-check button: a button that spends the user's money to
 * find out whether they can still spend money is the cost BYOK removes.
 *
 * Two provider kinds and only two (BYOK-02). "OpenAI-compatible" is one kind
 * rather than a family — OpenRouter, Groq, Together, DeepSeek, Mistral, a local
 * Ollama and vLLM are the same API at different addresses — so what tells them
 * apart is the base URL, and the field appears only for that kind. Gemini needs
 * none and showing it an empty one would invite somebody to fill it in.
 */
export const AIKeysPanel: React.FC = () => {
  const keys = useAiKeys()
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
      await refresh()
    } catch {
      setError("Could not save that key.")
    } finally {
      setSaving(false)
    }
  }

  const removeKey = async (id: string) => {
    await deleteAiKey(id)
    await refresh()
  }

  return (
    <TgSettingsSection icon={KeyRound} title="AI Keys">
      <p className="text-[10px] opacity-40 italic serif mb-6">
        Summaries, chats and tag runs are billed to your own provider key.
        Embeddings and translations stay on the deployment's key, because those
        rows are shared with everyone following the same channel.
      </p>

      <div className="space-y-4 mb-8">
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

      <div className="space-y-2">
        {keys.length === 0 ? (
          <div className="text-center py-8 opacity-30 italic serif text-[10px] border border-dashed border-app-ink/10">
            No AI keys saved yet. Add one to create summaries.
          </div>
        ) : (
          keys.map((key) => (
            <div
              key={key.id}
              className="group flex justify-between items-center p-4 border border-app-ink/10 bg-app-card hover:border-app-ink/30 transition-all"
            >
              <div className="min-w-0">
                <h3 className="text-[11px] font-bold uppercase tracking-widest truncate">
                  {key.label}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] font-mono opacity-40 truncate">
                    {key.baseUrl ?? key.provider}
                  </span>
                  {key.lastValidated ? (
                    <span className="flex items-center gap-1 text-[9px] font-mono text-green-500">
                      <CheckCircle2 size={10} /> Verified{" "}
                      <RelativeTime timestamp={key.lastValidated} />
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[9px] font-mono text-amber-500">
                      <AlertTriangle size={10} /> Not verified — still used
                    </span>
                  )}
                </div>
              </div>
              <TgIconButton
                aria-label="Delete AI Key"
                tooltip="Delete AI Key"
                onClick={() => removeKey(key.id)}
                className="rounded-full text-red-500 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-red-500/10 transition-opacity"
              >
                <Trash2 size={14} />
              </TgIconButton>
            </div>
          ))
        )}
      </div>
    </TgSettingsSection>
  )
}
