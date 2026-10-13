/**
 * The Directory filter's small Condition editors (DIR-02): Name contains,
 * Cited by your channels, Cited by @x / Cites @x (DIR-05) and Shared parents
 * / children (DIR-07), whose Seeds can be a Tag (DFP-05). Bounds have their
 * own editor.
 */
import type React from "react"
import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"
import { toVirtualGroupTagName } from "@/lib/channels/virtual-group-tags"
import {
  DIRECTORY_FILTER_BOUNDS,
  type DirectoryCond,
  type DirectoryHandlesCond,
  type DirectorySharedCond,
  HANDLES_LABEL,
  type LiveSource,
  parseHandles,
  type SeedSets,
  type SeedSource,
  SHARED_LABEL,
  SHARED_MIN,
} from "@/lib/directory/directory-filter"
import type { TagChoices } from "./directory-vocabulary"

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

/** The Tags a Seed source can name: the Account's, then its Setting groups'. */
const tagNames = (tags: TagChoices) => [
  ...tags.tags.map((t) => t.name),
  ...tags.groups.map(toVirtualGroupTagName),
]

/** One radio of a Seed source choice, its hint under the label. */
function SourceChoice({
  group,
  label,
  hint,
  off,
  checked,
  onChoose,
}: {
  group: string
  label: string
  hint: string
  off: boolean
  checked: boolean
  onChoose: () => void
}) {
  return (
    <label
      className={`flex items-start gap-2 text-xs ${off ? "opacity-40" : ""}`}
    >
      <input
        type="radio"
        name={group}
        className="mt-0.5"
        disabled={off}
        checked={checked}
        onChange={onChoose}
      />
      <span>
        {label}
        <span className="block text-[10px] text-app-ink/50">{hint}</span>
      </span>
    </label>
  )
}

/** The Tag picker a Tag source shows while it is chosen. */
function TagPicker({
  names,
  value,
  onChange,
}: {
  names: string[]
  value: string
  onChange: (name: string) => void
}) {
  return (
    <select
      aria-label="Tag"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={fieldClass}
    >
      {names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  )
}

const TAG_HINT = "Live: follows the Tag as you tag and untag Channels."

/** Where "Fill from" copies handles, as they are now; the copy stays fixed. */
const FILL_FROM: [LiveSource, string][] = [
  ["ticked", "Ticked here"],
  ["selection", "Channels tab selection"],
  ["follows", "Every follow"],
]

/**
 * "Cited by @x" or "Cites @x" (DIR-05): fixed handles, typed or filled from
 * the ticks, the selection or every follow, up to the server's 500; or a Tag,
 * which the server resolves on every read, so a group of any size fits
 * (DFP-05).
 */
export function HandlesEditor({
  type,
  start,
  sets,
  tags,
  onSubmit,
  onBack,
}: EditorProps<DirectoryHandlesCond> & {
  type: DirectoryHandlesCond["type"]
  /** The ticks, the Channels tab selection and the follows, as they are now. */
  sets: SeedSets
  tags: TagChoices
}) {
  const names = tagNames(tags)
  const seeds = start?.seeds
  const [byTag, setByTag] = useState(seeds?.kind === "tag")
  const [tag, setTag] = useState(
    seeds?.kind === "tag" ? seeds.name : (names[0] ?? ""),
  )
  const [text, setText] = useState(
    seeds?.kind === "handles" ? seeds.handles.join(" ") : "",
  )
  const handles = parseHandles(text)
  const most = DIRECTORY_FILTER_BOUNDS.handles
  const over = handles.length > most
  const submit = byTag
    ? tag && (() => onSubmit({ type, seeds: { kind: "tag", name: tag } }))
    : handles.length &&
      !over &&
      (() => onSubmit({ type, seeds: { kind: "handles", handles } }))
  return (
    <Shell
      title={HANDLES_LABEL[type]}
      explain={HANDLES_EXPLAIN[type]}
      onBack={onBack}
      submit={start ? "Update" : "Add"}
      onSubmit={submit || null}
    >
      <SourceChoice
        group={`${type}-seeds`}
        label="These channels"
        hint="Fixed: the handles you type or fill in."
        off={false}
        checked={!byTag}
        onChoose={() => setByTag(false)}
      />
      {!byTag && (
        <>
          <input
            // biome-ignore lint/a11y/noAutofocus: the editor is this one field
            autoFocus
            aria-label="Handles"
            placeholder="@durov @telegram"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={fieldClass}
          />
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="text-app-ink/50">Fill from</span>
            {FILL_FROM.map(([key, label]) => (
              <button
                key={key}
                type="button"
                disabled={!sets[key].length}
                onClick={() => setText(sets[key].map((h) => `@${h}`).join(" "))}
                className="rounded-full border border-app-ink/15 px-2 py-0.5 hover:bg-app-ink/5 disabled:opacity-30"
              >
                {label} ({sets[key].length})
              </button>
            ))}
          </div>
          {over && (
            <p className="text-[11px] text-red-500">
              {handles.length} channels; {HANDLES_LABEL[type]} takes {most} at
              most. Put them in a Tag and choose it below, which has no limit.
            </p>
          )}
        </>
      )}
      <SourceChoice
        group={`${type}-seeds`}
        label="A Tag"
        hint={TAG_HINT}
        off={!names.length}
        checked={byTag}
        onChoose={() => setByTag(true)}
      />
      {byTag && <TagPicker names={names} value={tag} onChange={setTag} />}
    </Shell>
  )
}

/** A Seed choice; "saved" keeps the ticks as they are now, as typed handles. */
type SeedChoice = SeedSource["kind"] | "saved"

const SHARED_EXPLAIN: Record<DirectorySharedCond["type"], string> = {
  parents:
    "Channels cited by the same channels that cite the ones below. Aggregators citing over 3,000 channels are skipped.",
  children:
    "Channels that cite the same channels the ones below cite. Only Channels somebody follows have their own outbound References recorded, so Seeds nobody follows find little.",
}

/** "Shared parents with…" or "Shared children with…" (DIR-07). */
export function SharedEditor({
  type,
  sets,
  tags,
  start,
  onSubmit,
  onBack,
}: EditorProps<DirectorySharedCond> & {
  type: DirectorySharedCond["type"]
  /** The ticks, the Channels tab selection and the follows, as they are now. */
  sets: SeedSets
  tags: TagChoices
}) {
  const ticked = sets.ticked.length > 0
  const names = tagNames(tags)
  const seeds = start?.seeds
  const [choice, setChoice] = useState<SeedChoice>(
    seeds?.kind ??
      (ticked ? "ticked" : sets.selection.length ? "selection" : "follows"),
  )
  const [text, setText] = useState(
    seeds?.kind === "handles" ? seeds.handles.join(" ") : "",
  )
  const [tag, setTag] = useState(
    seeds?.kind === "tag" ? seeds.name : (names[0] ?? ""),
  )
  const [min, setMin] = useState(start?.min ?? SHARED_MIN)
  const typed = parseHandles(text)
  const options: [SeedChoice, string, string, boolean][] = [
    [
      "ticked",
      `Channels ticked in this list (${sets.ticked.length})`,
      "Live: follows your ticks. A channel you tick while this is on leaves the results, since it is now a Seed.",
      !ticked && seeds?.kind !== "ticked",
    ],
    [
      "saved",
      `Channels ticked in this list, saved now (${sets.ticked.length})`,
      "Fixed: keeps these handles; ticking later leaves it alone.",
      !ticked,
    ],
    [
      "selection",
      `Your Channels tab selection (${sets.selection.length})`,
      "Live: follows that tab's selection.",
      false,
    ],
    [
      "follows",
      `Every channel you follow (${sets.follows.length})`,
      "Live: follows your follows.",
      false,
    ],
    ["tag", "A Tag", TAG_HINT, !names.length && seeds?.kind !== "tag"],
    ["handles", "These channels", "Fixed: the handles you type.", false],
  ]
  const chosen = (): SeedSource =>
    choice === "saved"
      ? { kind: "handles", handles: sets.ticked }
      : choice === "handles"
        ? { kind: "handles", handles: typed }
        : choice === "tag"
          ? { kind: "tag", name: tag }
          : { kind: choice }
  const ready =
    choice === "handles" ? typed.length > 0 : choice !== "tag" || tag
  return (
    <Shell
      title={`${SHARED_LABEL[type]} with…`}
      explain={SHARED_EXPLAIN[type]}
      onBack={onBack}
      submit={start ? "Update" : "Add"}
      onSubmit={ready ? () => onSubmit({ type, seeds: chosen(), min }) : null}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-app-ink/40">
        Compared with
      </p>
      {options.map(([value, label, hint, off]) => (
        <SourceChoice
          key={value}
          group={`${type}-seeds`}
          label={label}
          hint={hint}
          off={off}
          checked={choice === value}
          onChoose={() => setChoice(value)}
        />
      ))}
      {choice === "tag" && (
        <TagPicker names={names} value={tag} onChange={setTag} />
      )}
      {choice === "handles" && (
        <input
          aria-label="Handles"
          placeholder="@one @two"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={fieldClass}
        />
      )}
      <label className="flex items-center gap-2 text-[11px] text-app-ink/60">
        At least
        <input
          type="number"
          min={1}
          aria-label="Minimum shared"
          value={min}
          onChange={(e) =>
            setMin(Math.max(1, Number.parseInt(e.target.value, 10) || 1))
          }
          className="h-7 w-16 rounded-md border border-app-ink/15 bg-app-muted px-2 text-xs tabular-nums outline-none"
        />
        shared
      </label>
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
