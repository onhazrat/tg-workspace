import { AlertTriangle, CheckCircle2, KeyRound, Trash2 } from "lucide-react"
import type React from "react"
import { AiKeyAddForm } from "@/components/ai/AiKeyAddForm"
import { RelativeTime } from "@/components/RelativeTime"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import { useAiKeys, useRefreshAiKeys } from "@/hooks/useAiKeys"
import { deleteAiKey } from "@/lib/aiKeys/store"

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
 * The add form left for `components/ai/AiKeyAddForm.tsx` once the Action tab's
 * run bar needed it too. This panel is no longer the only door, and it should
 * not be: the 400 that says a Key is missing comes from a run button two tabs
 * from here.
 */
export const AIKeysPanel: React.FC = () => {
  const keys = useAiKeys()
  const refresh = useRefreshAiKeys()

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

      <div className="mb-8">
        <AiKeyAddForm />
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
