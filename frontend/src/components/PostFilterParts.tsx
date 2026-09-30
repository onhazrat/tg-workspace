/**
 * The pieces the Posts filter bar is built from (PFB-02): a pill that opens a
 * small form, the forms' option list and checklist, and a count typed as
 * text. Layout and copy follow the A1b prototype
 * (`prototype/post-filter-ui`).
 */
import { ChevronDown } from "lucide-react"
import { Popover } from "radix-ui"
import React from "react"
import {
  CAP_SHORTCUTS,
  capCard,
  DEFAULT_VIEWS_VALUE,
  nearestViewStep,
  parseCount,
  VIEW_MEASURE_OPTIONS,
  VIEW_STEPS,
  viewMeasureDescription,
} from "@/lib/posts/post-filter-bar"
import type {
  MaxPostsPerChannelMode,
  PostSortOrder,
  ViewMeasure,
  ViewsFilter,
} from "@/lib/posts/post-view"

export const pillClass = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
    active
      ? "border-app-ink bg-app-ink text-app-bg"
      : "border-app-ink/15 bg-app-muted hover:border-app-ink/30"
  }`

/** A pill reading `Label value`, filled when not at its default, opening a form. */
export function Pill({
  label,
  value,
  active,
  width = "w-64",
  testId,
  onOpenChange,
  children,
}: {
  label: string
  value: string
  active: boolean
  width?: string
  testId?: string
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <Popover.Root onOpenChange={onOpenChange}>
      <Popover.Trigger className={pillClass(active)} data-testid={testId}>
        <span className={active ? "opacity-70" : "text-app-ink/60"}>
          {label}
        </span>
        <span className="font-semibold">{value}</span>
        <ChevronDown size={12} className="opacity-60" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className={`z-50 ${width} max-w-[calc(100vw-2rem)] rounded-xl border border-app-ink/10 bg-app-card p-3 text-xs shadow-xl`}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** One choice among several; choosing closes the form. */
export function Options<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[]
  value: NoInfer<T>
  onChange: (value: NoInfer<T>) => void
}) {
  return (
    <div className="flex flex-col" role="radiogroup">
      {options.map((option) => (
        <Popover.Close
          key={option.value}
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2 py-1.5 text-left hover:bg-app-ink/5 ${option.value === value ? "font-semibold" : "text-app-ink/70"}`}
        >
          {option.value === value ? "● " : "○ "}
          {option.label}
        </Popover.Close>
      ))}
    </div>
  )
}

export interface CheckItem {
  key: string
  label: string
  /** Omitted when no count is known, as on a meaning search. */
  count?: number
  checked: boolean
  testId?: string
}

/** Several choices, each with its Post count, and an "Any" reset. */
export function CheckList({
  items,
  anyLabel,
  emptyLabel,
  onToggle,
  onAny,
}: {
  items: CheckItem[]
  anyLabel: string
  emptyLabel?: string
  onToggle: (key: string) => void
  onAny: () => void
}) {
  const anyChecked = items.some((item) => item.checked)
  return (
    <>
      <div className="flex max-h-72 flex-col overflow-y-auto">
        {items.length === 0 && emptyLabel && (
          <p className="px-2 py-1.5 text-app-ink/60">{emptyLabel}</p>
        )}
        {items.map((item) => (
          <label
            key={item.key}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-app-ink/5"
          >
            <input
              type="checkbox"
              data-testid={item.testId}
              checked={item.checked}
              onChange={() => onToggle(item.key)}
              className="accent-app-ink"
            />
            <span className="flex-1">{item.label}</span>
            {item.count != null && (
              <span className="font-mono text-[10px] opacity-50">
                {item.count.toLocaleString()}
              </span>
            )}
          </label>
        ))}
      </div>
      {anyChecked && (
        <button
          type="button"
          onClick={onAny}
          className="mt-2 text-app-ink/60 hover:underline"
        >
          {anyLabel}
        </button>
      )}
    </>
  )
}

/**
 * A count typed as text, so `1,000` works. Blank is `null`. The draft is kept
 * while it does not parse, and replaced when the value changes from outside.
 */
export function CountInput({
  value,
  onChange,
  placeholder,
  className = "",
  ariaLabel,
}: {
  value: number | null
  onChange: (value: number | null) => void
  placeholder?: string
  className?: string
  ariaLabel: string
}) {
  const [draft, setDraft] = React.useState(value == null ? "" : String(value))
  React.useEffect(() => {
    setDraft((current) =>
      parseCount(current) === value
        ? current
        : value == null
          ? ""
          : String(value),
    )
  }, [value])
  const bad = draft.trim() !== "" && parseCount(draft) == null
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      aria-invalid={bad}
      value={draft}
      placeholder={placeholder}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        setDraft(e.target.value)
        const parsed = parseCount(e.target.value)
        if (parsed != null || e.target.value.trim() === "") onChange(parsed)
      }}
      className={`rounded-lg border bg-app-muted px-2 py-1 font-mono text-xs focus:outline-none ${bad ? "border-red-500/60" : "border-app-ink/15 focus:border-app-ink/40"} ${className}`}
    />
  )
}

export const Heading = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-1.5 mt-3 text-[11px] font-semibold text-app-ink/60 first:mt-0">
    {children}
  </div>
)

const chipClass = (on: boolean) =>
  `rounded-full border px-2 py-0.5 font-mono text-[11px] ${on ? "border-app-ink bg-app-ink text-app-bg" : "border-app-ink/15 hover:border-app-ink/30"}`

function Card({
  on,
  onClick,
  title,
  body,
}: {
  on: boolean
  onClick: () => void
  title: string
  body: string
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex flex-1 flex-col items-start gap-0.5 rounded-lg border p-2 text-left ${on ? "border-app-ink bg-app-ink/5" : "border-app-ink/10 hover:border-app-ink/30"}`}
    >
      <span className="font-semibold">{title}</span>
      <span className="text-[11px] text-app-ink/60">{body}</span>
    </button>
  )
}

/** The Per channel form: how many Posts from each channel, and which ones. */
export function PerChannelForm({
  cap,
  setCap,
  mode,
  setMode,
  order,
}: {
  cap: number
  setCap: (value: number) => void
  mode: MaxPostsPerChannelMode
  setMode: (value: MaxPostsPerChannelMode) => void
  order: PostSortOrder
}) {
  const set = (value: number) => setCap(Math.max(0, value))
  const shown = cap ? String(cap) : "N"
  const first = capCard(order, shown)
  return (
    <>
      <Heading>Posts from each channel</Heading>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Fewer"
          onClick={() => set(cap - 1)}
          disabled={cap === 0}
          className="h-7 w-7 rounded-md border border-app-ink/15 disabled:opacity-30"
        >
          −
        </button>
        <CountInput
          ariaLabel="Posts from each channel"
          className="w-16 text-center"
          placeholder="all"
          value={cap || null}
          onChange={(value) => set(value ?? 0)}
        />
        <button
          type="button"
          aria-label="More"
          onClick={() => set(cap + 1)}
          className="h-7 w-7 rounded-md border border-app-ink/15"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => set(0)}
          className={`ml-2 ${chipClass(cap === 0)}`}
        >
          No limit
        </button>
      </div>
      <div className="mt-2 flex gap-1.5">
        {CAP_SHORTCUTS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => set(value)}
            className={chipClass(cap === value)}
          >
            {value}
          </button>
        ))}
      </div>
      <Heading>Which ones</Heading>
      <div
        className={`flex gap-2 ${cap === 0 ? "pointer-events-none opacity-40" : ""}`}
      >
        <Card
          on={mode === "ordered"}
          onClick={() => setMode("ordered")}
          title={first.title}
          body={first.body}
        />
        <Card
          on={mode === "random"}
          onClick={() => setMode("random")}
          title="Random"
          body={`${shown} picked at random`}
        />
      </div>
      <p className="mt-2 text-[11px] text-app-ink/50">
        The first choice follows the Order.
      </p>
    </>
  )
}

/**
 * The Views form (PFB-03): which measure, which side, and how many. A number
 * typed or slid with no side chosen yet is Popular, and a side chosen with no
 * number yet is 10K.
 */
export function ViewsForm({
  measure,
  setMeasure,
  views,
  setViews,
  floorHours,
}: {
  measure: ViewMeasure
  setMeasure: (value: ViewMeasure) => void
  views: ViewsFilter | null
  setViews: (value: ViewsFilter | null) => void
  floorHours: number
}) {
  const op = views?.op ?? "gte"
  const setValue = (value: number | null) =>
    setViews(value == null ? null : { op, value })
  return (
    <>
      <div className="flex gap-3 border-b border-app-ink/10" role="tablist">
        {VIEW_MEASURE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={option.value === measure}
            onClick={() => setMeasure(option.value)}
            className={`-mb-px border-b-2 pb-1.5 ${option.value === measure ? "border-app-ink font-semibold" : "border-transparent text-app-ink/60"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-app-ink/60">
        {viewMeasureDescription(measure, floorHours)}
      </p>
      <div className="mt-3 flex gap-2">
        <Card
          on={views?.op === "gte"}
          onClick={() =>
            setViews({ op: "gte", value: views?.value ?? DEFAULT_VIEWS_VALUE })
          }
          title="Popular"
          body="At least this many"
        />
        <Card
          on={views?.op === "lte"}
          onClick={() =>
            setViews({ op: "lte", value: views?.value ?? DEFAULT_VIEWS_VALUE })
          }
          title="Niche"
          body="At most this many"
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <CountInput
          ariaLabel="Views"
          className="w-24"
          placeholder="any"
          value={views?.value ?? null}
          onChange={setValue}
        />
        <span className="text-app-ink/60">views</span>
        {views && (
          <button
            type="button"
            onClick={() => setViews(null)}
            className="ml-auto text-app-ink/60 hover:underline"
          >
            Clear
          </button>
        )}
      </div>
      <input
        type="range"
        aria-label="Views, on a log scale"
        min={0}
        max={VIEW_STEPS.length - 1}
        step={1}
        value={nearestViewStep(views?.value ?? DEFAULT_VIEWS_VALUE)}
        onChange={(e) => setValue(VIEW_STEPS[Number(e.target.value)])}
        className={`mt-3 w-full accent-app-ink ${views ? "" : "opacity-40"}`}
      />
    </>
  )
}
