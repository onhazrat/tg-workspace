import type { BoundKind } from "@/lib/channels/channel-metrics"

const OPS: [BoundKind, string][] = [
  ["gte", "at least"],
  ["lte", "at most"],
  ["between", "between"],
  ["none", "no value"],
]

const fieldClass =
  "h-8 min-w-0 flex-1 rounded-md border border-app-ink/15 bg-app-muted px-2 text-xs tabular-nums outline-none focus:border-app-ink/40"

/**
 * A bound's operator and its one or two fields, shared by the Channels
 * number editor and the Posts views editor. What the fields spell is
 * `channel-metrics.ts::parseBound`'s to read.
 */
export function BoundFields({
  op,
  setOp,
  a,
  setA,
  b,
  setB,
  min,
}: {
  op: BoundKind
  setOp: (op: BoundKind) => void
  a: string
  setA: (text: string) => void
  b: string
  setB: (text: string) => void
  /** The lowest value a field offers, where the measure has one. */
  min?: number
}) {
  const field = (label: string, value: string, set: (t: string) => void) => (
    <input
      type="number"
      min={min}
      step="any"
      aria-label={label}
      value={value}
      onChange={(e) => set(e.target.value)}
      className={fieldClass}
    />
  )
  return (
    <>
      <fieldset aria-label="Operator" className="m-0 flex gap-1 border-0 p-0">
        {OPS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={op === key}
            onClick={() => setOp(key)}
            className={`flex-1 rounded-md border px-1.5 py-1 text-[11px] font-semibold ${
              op === key
                ? "border-app-ink bg-app-ink text-app-bg"
                : "border-app-ink/15 hover:border-app-ink/40"
            }`}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {op !== "none" && (
        <div className="flex items-center gap-1.5">
          {field(op === "between" ? "From" : "Value", a, setA)}
          {op === "between" && (
            <>
              <span className="text-app-ink/50">and</span>
              {field("To", b, setB)}
            </>
          )}
        </div>
      )}
    </>
  )
}
