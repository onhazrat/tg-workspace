import type { LucideIcon } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { BarHeading, BarPopover, BarSearch } from "@/components/BarPopover"
import type { BaseCond } from "@/lib/filter-tree"

export type ConditionOption = { id: string; label: string; hint?: string }

/** A kind of Condition picked by name from a list: a tag, a Language. */
type ListEntry<C> = {
  kind: "list"
  id: string
  label: string
  icon: LucideIcon
  options: ConditionOption[]
  make: (value: string) => C
  /** The value a Condition of this kind holds, to mark it in the list. */
  current: (cond: C) => string | undefined
}

/** A kind of Condition set in its own editor: a bound on a number. */
type EditorEntry<C> = {
  kind: "editor"
  id: string
  label: string
  icon: LucideIcon
  render: (props: {
    start?: C
    onSubmit: (cond: C) => void
    onBack: () => void
  }) => React.ReactNode
}

export type PickerEntry<C> = ListEntry<C> | EditorEntry<C>

/** What one tab can filter on, in the picker's order. */
export type PickerVocabulary<C> = {
  sections: { heading?: string; entries: PickerEntry<C>[] }[]
  /** The entry a Condition belongs to, so a chip opens on its own list. */
  entryOf: (cond: C) => string
}

const itemClass =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-semibold hover:bg-app-ink/5"

function PickerBody<C extends BaseCond>({
  start,
  vocabulary,
  onPick,
}: {
  start?: C
  vocabulary: PickerVocabulary<C>
  onPick: (cond: C) => void
}) {
  const [step, setStep] = useState<string | null>(
    start ? vocabulary.entryOf(start) : null,
  )
  const [query, setQuery] = useState("")
  const match = (text: string) =>
    text.toLowerCase().includes(query.trim().toLowerCase())
  const go = (next: string | null) => {
    setStep(next)
    setQuery("")
  }
  const entry = vocabulary.sections
    .flatMap((s) => s.entries)
    .find((e) => e.id === step)
  const own = start && entry && vocabulary.entryOf(start) === entry.id

  if (entry?.kind === "editor") {
    return entry.render({
      start: own ? start : undefined,
      onSubmit: onPick,
      onBack: () => go(null),
    })
  }
  if (entry) {
    const Icon = entry.icon
    const marked = own && start ? entry.current(start) : undefined
    return (
      <>
        <BarSearch
          value={query}
          onChange={setQuery}
          placeholder={`Search ${entry.label.toLowerCase()}s...`}
        />
        <button
          type="button"
          onClick={() => go(null)}
          className="px-2 pb-1 text-[11px] font-semibold text-app-ink/50 hover:text-app-ink"
        >
          ← All conditions
        </button>
        {entry.options
          .filter((option) => match(option.label))
          .map((option) => (
            <button
              key={option.id}
              type="button"
              aria-current={marked === option.id}
              onClick={() => onPick(entry.make(option.id))}
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
      {vocabulary.sections.map((section, i) => {
        const shown = section.entries.filter(
          (e) =>
            (e.kind === "editor" || e.options.length > 0) && match(e.label),
        )
        return (
          <div key={section.heading ?? i}>
            {section.heading && <BarHeading>{section.heading}</BarHeading>}
            {shown.map((e) => {
              const Icon = e.icon
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => go(e.id)}
                  className={itemClass}
                >
                  <Icon size={11} aria-hidden />
                  {e.label}
                  {e.kind === "list" && (
                    <span className="ml-auto text-app-ink/40">›</span>
                  )}
                </button>
              )
            })}
          </div>
        )
      })}
    </>
  )
}

/**
 * The condition picker (CTB-03) a "+" or a chip's label opens: a value by
 * name from one kind's list, or a number through its editor, with a search.
 * Opened on a Condition, it starts at that Condition's list. Each tab passes
 * its own vocabulary; Channels and Posts share everything else.
 */
export function ConditionPicker<C extends BaseCond>({
  trigger,
  start,
  vocabulary,
  onPick,
}: {
  trigger: React.ReactElement
  start?: C
  vocabulary: PickerVocabulary<C>
  onPick: (cond: C) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <BarPopover open={open} onOpenChange={setOpen} trigger={trigger}>
      <PickerBody
        start={start}
        vocabulary={vocabulary}
        onPick={(cond) => {
          onPick(cond)
          setOpen(false)
        }}
      />
    </BarPopover>
  )
}
