import { RotateCcw } from "lucide-react"
import type React from "react"
import { TgButton } from "@/components/ui/tg-button"
import { TgInput } from "@/components/ui/tg-input"
import {
  DEFAULT_DISCOVER_SIGNAL_WEIGHTS,
  DISCOVER_WEIGHT_MAX,
  DISCOVER_WEIGHT_MIN,
  DISCOVERY_SIGNAL_KINDS,
  DISCOVERY_SIGNAL_LABELS,
  type DiscoverSignalWeights,
} from "@/lib/posts/discover-candidates"

interface DiscoverWeightsEditorProps {
  weights: DiscoverSignalWeights
  onChange: (weights: DiscoverSignalWeights) => void
}

/**
 * Per-kind weights for the "Weighted" sort.
 *
 * Shown only while that sort is active — these are the knobs *behind* the
 * current ordering, so surfacing them at all other times would be three inputs
 * that change nothing on screen. Re-ranking happens client-side over the saved
 * report, so edits apply immediately without regenerating.
 */
export const DiscoverWeightsEditor: React.FC<DiscoverWeightsEditorProps> = ({
  weights,
  onChange,
}) => {
  const isDefault = DISCOVERY_SIGNAL_KINDS.every(
    (kind) => weights[kind] === DEFAULT_DISCOVER_SIGNAL_WEIGHTS[kind],
  )

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="discover-weights-editor"
    >
      <span className="text-[11px] font-bold uppercase tracking-widest text-app-ink/50">
        Weights
      </span>
      {DISCOVERY_SIGNAL_KINDS.map((kind) => (
        <label key={kind} className="flex items-center gap-1 text-xs">
          <span className="text-app-ink/60">
            {DISCOVERY_SIGNAL_LABELS[kind]}
          </span>
          <TgInput
            variant="muted"
            type="number"
            min={DISCOVER_WEIGHT_MIN}
            max={DISCOVER_WEIGHT_MAX}
            step={1}
            value={String(weights[kind])}
            aria-label={`${DISCOVERY_SIGNAL_LABELS[kind]} weight`}
            data-testid={`discover-weight-${kind}`}
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10)
              // An empty or half-typed field must not wipe the weight; keep the
              // previous value until the input parses to a number in range.
              if (Number.isNaN(next)) return
              onChange({
                ...weights,
                [kind]: Math.min(
                  DISCOVER_WEIGHT_MAX,
                  Math.max(DISCOVER_WEIGHT_MIN, next),
                ),
              })
            }}
            className="w-14 tabular-nums"
          />
        </label>
      ))}
      {!isDefault ? (
        <TgButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onChange({ ...DEFAULT_DISCOVER_SIGNAL_WEIGHTS })}
          data-testid="discover-weights-reset"
          className="rounded-full"
        >
          <RotateCcw size={11} />
          Reset
        </TgButton>
      ) : null}
    </div>
  )
}
