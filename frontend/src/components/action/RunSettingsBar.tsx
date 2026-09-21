import { Brain, ChevronDown, KeyRound, Languages, Plus } from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"

import { AiKeyAddForm } from "@/components/ai/AiKeyAddForm"
import { ModelCombo } from "@/components/ai/ModelCombo"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LANGUAGES } from "@/constants"
import { useSettings } from "@/contexts/SettingsContext"
import { useAiKeys, useSelectedAiKeyId } from "@/hooks/useAiKeys"
import { modelForKey } from "@/lib/aiKeys/modelMemory"
import { rememberAiKeyId } from "@/lib/aiKeys/selection"

/**
 * Model, key and language, once, for the whole Action tab.
 *
 * These selectors sat inside the Summary card while `AIContext`, `TagContext`
 * and `ChatContext` all read the same `useSettings` values — so changing the
 * model for a tag run meant opening the summary form and setting it there. The
 * state was always shared; only the placement said otherwise. Discover is the
 * exception and does no inference at all: its report is a server-side
 * aggregation, so none of these reach it.
 *
 * The chevrons are not decoration. Language is a native `<select>` styled as a
 * chip, and `appearance: none` strips the platform's own dropdown arrow —
 * measured on staging, there was provably no affordance of any kind without
 * them. `pointer-events-none` keeps the click falling through.
 *
 * **The AI Key chip is always here now, including at zero Keys.** It used to
 * appear only above two Keys, on the argument that with fewer there was nothing
 * to choose between — true about *choosing*, and wrong about everything else.
 * An account with no Key gets `AI_KEY_MISSING_DETAIL` from the run button
 * directly below this bar, and the only cure lived in Settings → AI Keys, two
 * tabs away and unmentioned by the error. So the chip becomes an add button
 * when there is nothing to select, and keeps a small one beside it when there
 * is. The form is `AiKeyAddForm`, the same component the settings panel
 * renders — one copy of the provider rules, in a dialog here.
 *
 * The add button is a chip of its own rather than a control inside the key
 * chip, because the key chip's whole surface is the `<select>`'s hit area: a
 * button sharing it would open a dropdown or a dialog depending on a few
 * pixels.
 */
export const RunSettingsBar: React.FC = () => {
  const { selectedModel, setSelectedModel, aiLanguage, setAiLanguage } =
    useSettings()
  const aiKeys = useAiKeys()
  const selectedKeyId = useSelectedAiKeyId()
  const [addOpen, setAddOpen] = useState(false)

  // Checked against the list rather than taken on trust. `selectedKeyId` can
  // name a Key this list no longer has for the render between the fetch landing
  // and the reconcile's write being observed, and a `<select>` whose `value`
  // matches no `<option>` shows the wrong label *and* warns about an
  // uncontrolled change.
  const activeAiKeyId =
    (aiKeys.some((k) => k.id === selectedKeyId) ? selectedKeyId : null) ??
    aiKeys[0]?.id ??
    ""

  /**
   * Switching Key switches back to the model you last ran on it.
   *
   * **Here rather than in `ModelCombo`, which is where the other half lives.**
   * The recording belongs on the picker because all three model pickers write
   * the same setting and any of them can be the one you chose in; applying
   * belongs here because this bar holds the only control that changes the Key.
   * Putting the effect on the picker instead would mount it three times to
   * serve an event only one of them can raise.
   *
   * A Key with nothing recorded leaves the model alone, which is what makes
   * this safe to add to an account that has never used it: the map is empty,
   * the effect is a no-op, and nothing moves until a first deliberate choice
   * puts something in it.
   *
   * It is not the repair effect under a new name. That one overwrote a value
   * somebody typed with a default the *server* suggested, on the catalogue
   * arriving; this restores a value the account itself chose, and only when the
   * Key changes.
   */
  useEffect(() => {
    const remembered = modelForKey(selectedKeyId)
    if (remembered && remembered !== selectedModel) setSelectedModel(remembered)
  }, [selectedKeyId, selectedModel, setSelectedModel])

  const addButton = (
    <button
      type="button"
      onClick={() => setAddOpen(true)}
      aria-label="Add AI key"
      title="Add an AI key"
      className="flex h-10 items-center gap-2 rounded-lg border border-app-ink/10 bg-app-muted/20 px-3 text-xs font-bold uppercase tracking-tight transition-colors hover:bg-app-muted/30"
    >
      <Plus size={14} className="text-app-ink/50" />
      {aiKeys.length === 0 && <span>Add AI key</span>}
    </button>
  )

  return (
    <section
      data-testid="action-run-settings"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-app-ink/10 bg-app-card p-4 shadow-sm"
    >
      <div className="mr-auto">
        <h3 className="text-sm font-bold uppercase tracking-tight">Run with</h3>
        <p className="mt-0.5 text-[11px] text-app-ink/60">
          {aiKeys.length === 0
            ? "No AI keys saved yet. Add one to create summaries."
            : "Applies to summaries, tag runs and chats."}
        </p>
      </div>

      {/*
       * Key first, then model, then language — the order the choices depend on
       * each other in. The Key decides which catalogue the model picker can
       * offer and which model the bar restores, so putting it second asked you
       * to choose from a list before choosing what produced the list.
       */}
      {aiKeys.length > 0 && (
        <div className="flex h-10 items-center gap-2 rounded-lg border border-app-ink/10 bg-app-muted/20 px-3 transition-colors hover:bg-app-muted/30">
          <KeyRound size={14} className="text-app-ink/50" />
          <select
            aria-label="AI key"
            value={activeAiKeyId}
            onChange={(e) => rememberAiKeyId(e.target.value)}
            className="max-w-[160px] cursor-pointer appearance-none truncate bg-transparent font-mono text-xs focus:outline-none"
            title="Which key pays for this run"
          >
            {aiKeys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            aria-hidden="true"
            className="pointer-events-none shrink-0 text-app-ink/40"
          />
        </div>
      )}

      {addButton}

      <div className="flex h-10 items-center gap-2 rounded-lg border border-app-ink/10 bg-app-muted/20 px-3 transition-colors hover:bg-app-muted/30">
        <Brain size={14} className="text-app-ink/50" />
        <ModelCombo
          ariaLabel="Inference model"
          value={selectedModel}
          onChange={setSelectedModel}
          className="max-w-[180px] bg-transparent font-mono text-xs focus:outline-none"
        />
      </div>

      <div className="flex h-10 items-center gap-2 rounded-lg border border-app-ink/10 bg-app-muted/20 px-3 transition-colors hover:bg-app-muted/30">
        <Languages size={14} className="text-app-ink/50" />
        <select
          aria-label="Output language"
          value={aiLanguage}
          onChange={(e) => setAiLanguage(e.target.value)}
          className="max-w-[130px] cursor-pointer appearance-none truncate bg-transparent font-mono text-xs focus:outline-none"
          title="Output Language"
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          aria-hidden="true"
          className="pointer-events-none shrink-0 text-app-ink/40"
        />
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add an AI key</DialogTitle>
            <DialogDescription>
              Summaries, chats and tag runs are billed to your own provider key.
            </DialogDescription>
          </DialogHeader>
          {/* Closes on a verified save only. A key that saved without
              verifying is used all the same, but the sentence saying so is
              inside the form — closing over it would throw away the one state
              that has something to read. */}
          <AiKeyAddForm onSaved={() => setAddOpen(false)} />
        </DialogContent>
      </Dialog>
    </section>
  )
}
