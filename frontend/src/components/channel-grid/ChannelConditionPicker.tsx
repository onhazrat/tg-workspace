import { Languages, Layers, SlidersHorizontal, Tag } from "lucide-react"
import type React from "react"
import { useState } from "react"
import type {
  Cond,
  CondType,
  MetricCond,
  ValueCond,
} from "@/lib/channels/channel-filter"
import { METRICS, type MetricData } from "@/lib/channels/channel-metrics"
import { BarHeading, BarPopover, BarSearch } from "./BarPopover"
import { ChannelMetricEditor } from "./ChannelMetricEditor"

export type ConditionOption = { id: string; label: string; hint?: string }
/** What the picker offers for each kind of Condition. */
export type ConditionOptions = Record<CondType, ConditionOption[]>

export const CONDITION_ICON: Record<Cond["type"], typeof Tag> = {
  tag: Tag,
  group: Layers,
  language: Languages,
  metric: SlidersHorizontal,
}

const KINDS: [CondType, string][] = [
  ["tag", "Tag"],
  ["group", "Setting group"],
  ["language", "Language"],
]

/** Which list the picker shows: the kinds, one kind's values, or a number. */
type Step = null | Pick<ValueCond, "type"> | Pick<MetricCond, "type" | "metric">

const itemClass =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-semibold hover:bg-app-ink/5"

function PickerBody({
  start,
  options,
  metrics,
  onPick,
}: {
  start?: Cond
  options: ConditionOptions
  metrics: MetricData
  onPick: (cond: Cond) => void
}) {
  const [step, setStep] = useState<Step>(start ?? null)
  const [query, setQuery] = useState("")
  const match = (text: string) =>
    text.toLowerCase().includes(query.trim().toLowerCase())
  const go = (next: Step) => {
    setStep(next)
    setQuery("")
  }

  if (step?.type === "metric") {
    return (
      <ChannelMetricEditor
        metricKey={step.metric}
        data={metrics}
        initial={
          start?.type === "metric" && start.metric === step.metric
            ? start
            : undefined
        }
        onBack={() => go(null)}
        onSubmit={(bound) =>
          onPick({ type: "metric", metric: step.metric, ...bound })
        }
      />
    )
  }
  if (step) {
    const Icon = CONDITION_ICON[step.type]
    const noun = KINDS.find(([type]) => type === step.type)?.[1] ?? ""
    return (
      <>
        <BarSearch
          value={query}
          onChange={setQuery}
          placeholder={`Search ${noun.toLowerCase()}s...`}
        />
        <button
          type="button"
          onClick={() => go(null)}
          className="px-2 pb-1 text-[11px] font-semibold text-app-ink/50 hover:text-app-ink"
        >
          ← All conditions
        </button>
        {options[step.type]
          .filter((option) => match(option.label))
          .map((option) => (
            <button
              key={option.id}
              type="button"
              aria-current={
                start?.type === step.type && start.value === option.id
              }
              onClick={() => onPick({ type: step.type, value: option.id })}
              className={itemClass}
            >
              <Icon size={11} aria-hidden />
              {option.label}
              {option.hint && (
                <span className="ml-auto font-normal text-app-ink/50">
                  {option.hint}
                </span>
              )}
            </button>
          ))}
      </>
    )
  }
  return (
    <>
      <BarSearch
        value={query}
        onChange={setQuery}
        placeholder="Search conditions..."
      />
      {KINDS.filter(
        ([type, label]) => options[type].length > 0 && match(label),
      ).map(([type, label]) => {
        const Icon = CONDITION_ICON[type]
        return (
          <button
            key={type}
            type="button"
            onClick={() => go({ type })}
            className={itemClass}
          >
            <Icon size={11} aria-hidden />
            {label}
            <span className="ml-auto text-app-ink/40">›</span>
          </button>
        )
      })}
      <BarHeading>Numbers</BarHeading>
      {METRICS.filter((m) => match(m.label)).map((m) => (
        <button
          key={m.key}
          type="button"
          onClick={() => go({ type: "metric", metric: m.key })}
          className={itemClass}
        >
          <SlidersHorizontal size={11} aria-hidden />
          {m.label}
        </button>
      ))}
    </>
  )
}

/**
 * The condition picker (CTB-03) a "+" or a chip's label opens: a tag,
 * Setting group or Language by name, or a number through its editor, with a
 * search. Opened on a Condition, it starts at that Condition's list.
 */
export function ChannelConditionPicker({
  trigger,
  start,
  options,
  metrics,
  onPick,
}: {
  trigger: React.ReactElement
  start?: Cond
  options: ConditionOptions
  metrics: MetricData
  onPick: (cond: Cond) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <BarPopover open={open} onOpenChange={setOpen} trigger={trigger}>
      <PickerBody
        start={start}
        options={options}
        metrics={metrics}
        onPick={(cond) => {
          onPick(cond)
          setOpen(false)
        }}
      />
    </BarPopover>
  )
}
