/**
 * The Directory filter's small Condition editors (DIR-02): Name contains,
 * Cited by your channels, and Cited by @x / Cites @x (DIR-05). Bounds have
 * their own editor.
 */
import type React from "react"
import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"
import {
  type DirectoryCond,
  type DirectoryHandlesCond,
  HANDLES_LABEL,
  parseHandles,
} from "@/lib/directory/directory-filter"

type EditorProps<C> = {
  start?: C
  onSubmit: (cond: DirectoryCond) => void
  onBack?: () => void
}

const fieldClass =
  "h-8 w-full rounded-md border border-app-ink/15 bg-app-muted px-2 text-xs outline-none focus:border-app-ink/40"

function Shell({
  title,
  explain,
  onBack,
  onSubmit,
  submit,
  children,
}: {
  title: string
  explain: string
  onBack?: () => void
  onSubmit: (() => void) | null
  submit: string
  children: React.ReactNode
}) {
  return (
    <form
      className="space-y-2 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.()
      }}
    >
      <div className="flex items-center gap-2 text-xs font-semibold">
        {onBack && (
          <button
            type="button"
            aria-label="Back to the conditions"
            onClick={onBack}
            className="text-app-ink/50 hover:text-app-ink"
          >
            ←
          </button>
        )}
        {title}
      </div>
      <p className="text-[11px] text-app-ink/50">{explain}</p>
      {children}
      <TgButton type="submit" size="sm" disabled={!onSubmit} className="w-full">
        {submit}
      </TgButton>
    </form>
  )
}

export function NameEditor({
  start,
  onSubmit,
  onBack,
}: EditorProps<Extract<DirectoryCond, { type: "name" }>>) {
  const [text, setText] = useState(start?.value ?? "")
  const value = text.trim()
  return (
    <Shell
      title="Name contains"
      explain="Any part of the handle or the display name, in any case."
      onBack={onBack}
      submit={start ? "Update" : "Add"}
      onSubmit={value ? () => onSubmit({ type: "name", value }) : null}
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: the editor is this one field
        autoFocus
        dir="auto"
        aria-label="Name contains"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={fieldClass}
      />
    </Shell>
  )
}

const HANDLES_EXPLAIN: Record<DirectoryHandlesCond["type"], string> = {
  citedby:
    "Channels any of these forwarded, mentioned, linked or replied to. The Reference kinds narrow it.",
  cites:
    "Channels that forwarded, mentioned, linked or replied to any of these. The Reference kinds narrow it.",
}

/** "Cited by @x" or "Cites @x", for one or several handles. */
export function HandlesEditor({
  type,
  start,
  onSubmit,
  onBack,
}: EditorProps<DirectoryHandlesCond> & { type: DirectoryHandlesCond["type"] }) {
  const [text, setText] = useState(start?.handles.join(" ") ?? "")
  const handles = parseHandles(text)
  return (
    <Shell
      title={HANDLES_LABEL[type]}
      explain={HANDLES_EXPLAIN[type]}
      onBack={onBack}
      submit={start ? "Update" : "Add"}
      onSubmit={handles.length ? () => onSubmit({ type, handles }) : null}
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: the editor is this one field
        autoFocus
        aria-label="Handles"
        placeholder="@durov @telegram"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={fieldClass}
      />
    </Shell>
  )
}

const WINDOWS = [7, 14, 30, 90]

const presetClass = (on: boolean) =>
  `rounded-full border px-2 py-0.5 font-mono text-[11px] ${on ? "border-app-ink bg-app-ink text-app-bg" : "border-app-ink/15 hover:border-app-ink/30"}`

export function MineEditor({
  start,
  onSubmit,
  onBack,
}: EditorProps<Extract<DirectoryCond, { type: "mine" }>>) {
  const [days, setDays] = useState<number | undefined>(start ? start.days : 14)
  return (
    <Shell
      title="Cited by your channels"
      explain="Your channels forwarded, mentioned, linked or replied to it. Which channels are yours is the Sort's Cited by choice, and the Reference kinds narrow it."
      onBack={onBack}
      submit={start ? "Update" : "Add"}
      onSubmit={() =>
        onSubmit(days ? { type: "mine", days } : { type: "mine" })
      }
    >
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          aria-pressed={days === undefined}
          onClick={() => setDays(undefined)}
          className={presetClass(days === undefined)}
        >
          any time
        </button>
        {WINDOWS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={days === d}
            onClick={() => setDays(d)}
            className={presetClass(days === d)}
          >
            {d}d
          </button>
        ))}
        <input
          type="number"
          min={1}
          aria-label="Days"
          value={days ?? ""}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10)
            setDays(n >= 1 ? n : undefined)
          }}
          className="h-7 w-16 rounded-md border border-app-ink/15 bg-app-muted px-2 text-xs tabular-nums outline-none"
        />
      </div>
    </Shell>
  )
}
