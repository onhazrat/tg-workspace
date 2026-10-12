/**
 * PROTOTYPE (directory-follow-picks, variant F): the Sets menu. Saves the
 * ticks as a named set, adds or removes the ticks from one, ticks a set's
 * Channels to look at them, and deletes one.
 */
import { Bookmark, X } from "lucide-react"
import { useState } from "react"
import { BarHeading, BarPopover } from "@/components/BarPopover"
import { pillClass } from "@/components/PostFilterParts"
import { pickSets, setName, usePickSets } from "./pick-sets"

const small =
  "rounded-md border border-app-ink/15 px-1.5 py-0.5 text-[11px] hover:bg-app-ink/5 disabled:opacity-30"

export function PickSetsMenu({
  ticks,
  onTicks,
}: {
  ticks: ReadonlySet<string>
  onTicks: (next: string[]) => void
}) {
  const sets = usePickSets()
  const [name, setNameText] = useState("")
  const ticked = [...ticks]
  const typed = setName(name)
  return (
    <BarPopover
      align="end"
      trigger={
        <button
          type="button"
          data-testid="directory-pick-sets"
          className={pillClass(false)}
        >
          <Bookmark size={12} /> Sets
          {sets.length > 0 && (
            <span className="rounded-full bg-app-ink/15 px-1.5 text-[10px] tabular-nums">
              {sets.length}
            </span>
          )}
        </button>
      }
    >
      <BarHeading>
        Save the {ticked.length} ticked channel{ticked.length === 1 ? "" : "s"}{" "}
        as a set
      </BarHeading>
      <form
        className="flex gap-1 px-2 pb-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!typed || !ticked.length) return
          pickSets.save(typed, ticked)
          setNameText("")
        }}
      >
        <input
          aria-label="Set name"
          placeholder="news, banks…"
          value={name}
          onChange={(e) => setNameText(e.target.value)}
          className="h-7 min-w-0 flex-1 rounded-md border border-app-ink/15 bg-app-muted px-2 text-xs outline-none focus:border-app-ink/40"
        />
        <button
          type="submit"
          disabled={!typed || !ticked.length}
          className="rounded-md bg-blue-600 px-2 text-[11px] font-semibold text-white disabled:opacity-30"
        >
          {sets.some((s) => s.name === typed) ? "Replace" : "Save"}
        </button>
      </form>
      <BarHeading>Your sets</BarHeading>
      {sets.length === 0 && (
        <p className="px-2 pb-2 text-[11px] text-app-ink/50">
          None yet. Tick channels, name them above, and the Shared and Cited
          filters can compare with the set.
        </p>
      )}
      <ul className="space-y-1 px-2 pb-1">
        {sets.map((s) => (
          <li key={s.name} className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate">
              <b>{s.name}</b>{" "}
              <span className="text-app-ink/50">{s.handles.length}</span>
            </span>
            <button
              type="button"
              className={small}
              title="Tick exactly this set's channels"
              onClick={() => onTicks(s.handles)}
            >
              Tick
            </button>
            <button
              type="button"
              className={small}
              disabled={!ticked.length}
              title="Add the ticked channels to this set"
              onClick={() => pickSets.add(s.name, ticked)}
            >
              +{ticked.length}
            </button>
            <button
              type="button"
              className={small}
              disabled={!ticked.some((h) => s.handles.includes(h))}
              title="Take the ticked channels out of this set"
              onClick={() => pickSets.remove(s.name, ticked)}
            >
              −
            </button>
            <button
              type="button"
              aria-label={`Delete the set ${s.name}`}
              className="rounded p-0.5 text-app-ink/40 hover:bg-app-ink/10 hover:text-app-ink"
              onClick={() =>
                window.confirm(`Delete the set "${s.name}"?`) &&
                pickSets.drop(s.name)
              }
            >
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
    </BarPopover>
  )
}
