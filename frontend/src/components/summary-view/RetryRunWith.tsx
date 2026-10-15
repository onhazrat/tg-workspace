import { AlertTriangle, Brain, ChevronDown, KeyRound } from "lucide-react"
import { useState } from "react"

import type { SummaryAttemptResponse } from "@/client"
import { ModelCombo } from "@/components/ai/ModelCombo"
import { useAiKeys, useSelectedAiKeyId } from "@/hooks/useAiKeys"
import { useAiModels } from "@/hooks/useAiModels"
import { modelForKey } from "@/lib/aiKeys/modelMemory"
import { modelOnKey, promptFit, retryStart } from "@/lib/summaries/retry-choice"

export type RetryChoice = { keyId: string | null; model: string }

/**
 * The retry's Key and model for the Summary on screen: where `retryStart`
 * says until somebody picks, then their pick, until another Summary opens.
 */
export function useRetryChoice(
  summaryId: string | null,
  attempts: readonly SummaryAttemptResponse[],
  summaryModel: string,
): [RetryChoice, (next: RetryChoice) => void] {
  const aiKeys = useAiKeys()
  const selectedKeyId = useSelectedAiKeyId()
  const [picked, setPicked] = useState<
    (RetryChoice & { summaryId: string | null }) | null
  >(null)
  const choice =
    picked && picked.summaryId === summaryId
      ? picked
      : retryStart(
          attempts,
          aiKeys.map((k) => k.id),
          selectedKeyId,
          summaryModel,
          modelForKey,
        )
  return [choice, (next) => setPicked({ ...next, summaryId })]
}

const CHIP =
  "flex h-10 items-center gap-2 rounded-lg border border-app-ink/10 bg-app-muted/20 px-3 transition-colors hover:bg-app-muted/30"

/**
 * The "Try again" card's Key and Model chips, styled like the Action tab's
 * "Run with" bar, and the warning when the saved prompt will not fit (SFR-04).
 *
 * Controlled, and it never writes the Account's selected Key or any Key's
 * remembered model: the retry is one rescue, not a change of defaults. Switching
 * Key restores the model last run on that Key.
 */
export function RetryRunWith({
  value,
  onChange,
  attempts,
  promptText,
}: {
  value: RetryChoice
  onChange: (next: RetryChoice) => void
  attempts: readonly SummaryAttemptResponse[]
  promptText: string | undefined
}) {
  const aiKeys = useAiKeys()
  const { models } = useAiModels(value.keyId)
  const window = models.find((m) => m.id === value.model)?.contextLength
  const fit = promptFit(promptText, window)
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {aiKeys.length > 0 && (
          <div className={CHIP}>
            <KeyRound size={14} className="text-app-ink/50" />
            <select
              aria-label="Retry AI key"
              value={value.keyId ?? ""}
              onChange={(e) => {
                const keyId = e.target.value
                onChange({
                  keyId,
                  model:
                    modelOnKey(attempts, keyId, modelForKey(keyId)) ??
                    value.model,
                })
              }}
              className="max-w-[160px] cursor-pointer appearance-none truncate bg-transparent font-mono text-xs focus:outline-none"
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
        <div className={CHIP}>
          <Brain size={14} className="text-app-ink/50" />
          <ModelCombo
            ariaLabel="Retry model"
            forKey={value.keyId}
            value={value.model}
            onChange={(model) => onChange({ ...value, model })}
            className="max-w-[180px] bg-transparent font-mono text-xs focus:outline-none"
          />
        </div>
      </div>
      {fit && (
        <p
          data-testid="prompt-fit"
          className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
          {fit === "wont-fit"
            ? "The saved prompt won't fit this model's context window."
            : "The saved prompt is tight: it fills most of this model's context window."}
        </p>
      )}
    </div>
  )
}
