import { ArrowDown, ArrowUp } from "lucide-react"
import { useState } from "react"
import { BarSearch } from "@/components/BarPopover"
import { Options, Pill } from "@/components/PostFilterParts"
import { TgIconButton } from "@/components/ui/tg-icon-button"

export type SortDirection = "asc" | "desc"

/**
 * Sort as a dropdown with a search over its options, and a direction arrow
 * beside it. Shared by the Channels and Posts tabs (PTR-04).
 */
export function SortPicker<T extends string>({
  options,
  value,
  onChange,
  direction,
  onToggleDirection,
  testId,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  direction: SortDirection
  onToggleDirection: () => void
  testId: string
}) {
  const [query, setQuery] = useState("")
  const label = options.find((option) => option.value === value)?.label
  const named = direction === "asc" ? "ascending" : "descending"
  return (
    <div className="flex items-center gap-0.5">
      <Pill
        label="Sort"
        value={label ?? options[0]?.label ?? ""}
        active={false}
        width="w-56"
        testId={testId}
      >
        <BarSearch
          value={query}
          onChange={setQuery}
          placeholder="Search sort options..."
        />
        <Options
          options={options.filter((option) =>
            option.label.toLowerCase().includes(query.trim().toLowerCase()),
          )}
          value={value}
          onChange={onChange}
        />
      </Pill>
      <TgIconButton
        aria-label={`Sort ${named}`}
        tooltip={`Sort ${named}`}
        onClick={onToggleDirection}
        className="h-8 w-8"
      >
        {direction === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
      </TgIconButton>
    </div>
  )
}
