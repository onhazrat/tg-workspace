// PROTOTYPE (find-prototype): variant Q, "Typed query". The filter is one
// line in the Channels tab's text form (`lang:fa and subscribers >= 10000 and
// not is:followed`), with autocomplete for keys, Languages, handles and
// metrics; the shared FilterRow under it shows the same tree as chips, and
// editing a chip rewrites the line. The search box stays its own field.

import { Check, Search, TriangleAlert } from "lucide-react"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { BarToggle } from "@/components/channel-grid/ChannelBarControls"
import { atoms } from "@/lib/filter-tree"
import { FLAG_LABEL, parseDirectory, printDirectory } from "./directory-filter"
import { type Dir, DirectoryResults, useDirectory } from "./directory-state"
import { fmt, useProto } from "./shared"
import { languageLabel, METRIC_SECTIONS } from "./VariantBrowseTop"
import {
  ColumnsPill,
  DirectoryFilterRow,
  DirectorySort,
  KindsPill,
  SearchFieldToggles,
} from "./VariantTabs"

type Suggestion = { text: string; label: string; hint?: string; open?: boolean }

const KEYS: Suggestion[] = [
  { text: "lang:", label: "lang:", hint: "Language", open: true },
  {
    text: "is:",
    label: "is:",
    hint: "followed, dismissed, available",
    open: true,
  },
  {
    text: "name:",
    label: "name:",
    hint: "handle or name contains",
    open: true,
  },
  {
    text: "citedby:",
    label: "citedby:",
    hint: "channels @x cites",
    open: true,
  },
  { text: "cites:", label: "cites:", hint: "channels citing @x", open: true },
  {
    text: "mine:",
    label: "mine:",
    hint: "cited by your channels, in N days",
    open: true,
  },
  {
    text: "parents:",
    label: "parents:",
    hint: "shared parents with…",
    open: true,
  },
  {
    text: "children:",
    label: "children:",
    hint: "shared children with…",
    open: true,
  },
  ...METRIC_SECTIONS.flatMap((s) =>
    s.metrics.map((m) => ({
      text: `${m.key} >= `,
      label: m.key,
      hint: m.label,
    })),
  ),
  { text: "and", label: "and" },
  { text: "or", label: "or" },
  { text: "not", label: "not" },
]

const EXAMPLES = [
  "lang:fa and subscribers >= 10000 and not is:followed",
  "mine:14d and not is:followed and not is:dismissed",
  "(lang:fa or lang:en) and reach >= 1000 and last_post_days <= 7",
  "citedby:durov and not is:followed",
]

/** The word the caret is in, from its start to the caret. */
function tokenAt(text: string, caret: number) {
  let start = caret
  while (start > 0 && !/[\s(]/.test(text[start - 1])) start--
  return { start, token: text.slice(start, caret) }
}

function useSuggestions(d: Dir, token: string): Suggestion[] {
  const colon = token.indexOf(":")
  const key = colon >= 0 ? token.slice(0, colon).toLowerCase() : null
  const val =
    colon >= 0
      ? token
          .slice(colon + 1)
          .replace(/^"/, "")
          .toLowerCase()
      : token.toLowerCase()
  const wantsHandles =
    key !== null &&
    ["citedby", "cites", "parents", "children"].includes(key) &&
    val.length >= 2
  const lookup = useProto<
    {
      handle: string
      display_name: string | null
      subscribers: number | null
    }[]
  >(wantsHandles ? `/lookup?prefix=${encodeURIComponent(val)}` : null, true)
  if (key === null)
    return KEYS.filter((k) => k.label.startsWith(val) && k.label !== val).slice(
      0,
      12,
    )
  if (key === "lang")
    return d.langs
      .filter(
        (l) =>
          l.language.startsWith(val) ||
          languageLabel(l.language).toLowerCase().startsWith(val),
      )
      .slice(0, 12)
      .map((l) => ({
        text: `lang:${l.language}`,
        label: languageLabel(l.language),
        hint: fmt(l.n),
      }))
  if (key === "is")
    return Object.entries(FLAG_LABEL)
      .filter(([k]) => k.startsWith(val))
      .map(([k, label]) => ({ text: `is:${k}`, label: k, hint: label }))
  if (key === "mine")
    return ["7d", "14d", "30d", "90d", "all"].map((w) => ({
      text: `mine:${w}`,
      label: w,
      hint: w === "all" ? "any time" : `last ${w}`,
    }))
  const picks =
    key === "parents" || key === "children"
      ? (["selection", "follows"] as const)
          .filter((w) => w.startsWith(val))
          .map((w) => ({ text: `${key}:${w}`, label: w, hint: `your ${w}` }))
      : []
  return [
    ...picks,
    ...(lookup.data ?? []).map((h) => ({
      text: `${key}:${h.handle}`,
      label: `@${h.handle}`,
      hint: [h.display_name, h.subscribers != null ? fmt(h.subscribers) : null]
        .filter(Boolean)
        .join(" · "),
    })),
  ]
}

function QueryLine({ d }: { d: Dir }) {
  const [draft, setDraft] = useState(d.view.f)
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  // The text we last sent; a different `view.f` came from a chip, so it wins.
  const sent = useRef(d.view.f)
  useEffect(() => {
    if (d.view.f !== sent.current) {
      sent.current = d.view.f
      setDraft(d.view.f)
    }
  }, [d.view.f])
  const parsed = parseDirectory(draft)
  const { start, token } = tokenAt(draft, caret)
  const suggestions = useSuggestions(d, token)
  const open = focused && suggestions.length > 0

  const change = (text: string, at: number) => {
    setDraft(text)
    setCaret(at)
    setActive(0)
    const t = parseDirectory(text)
    if (t) {
      // setTree stores the tree printed tidily; remembering that text keeps
      // it from replacing what is being typed.
      sent.current = printDirectory(t)
      d.setTree(t)
    }
  }

  const accept = (s: Suggestion) => {
    const insert = s.open ? s.text : `${s.text} `
    const next = draft.slice(0, start) + insert + draft.slice(caret)
    const at = start + insert.length
    change(next, at)
    requestAnimationFrame(() => input.current?.setSelectionRange(at, at))
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const n = suggestions.length
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n)
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      accept(suggestions[Math.min(active, suggestions.length - 1)])
    } else if (e.key === "Escape") {
      setFocused(false)
    }
  }

  return (
    <div className="relative">
      <div
        className={`flex items-center gap-2 rounded-xl border bg-app-muted px-3 ${parsed ? "border-app-ink/15 focus-within:border-app-ink/40" : "border-amber-500/60"}`}
      >
        <span className="font-mono text-xs text-app-ink/40">filter</span>
        <input
          ref={input}
          dir="ltr"
          spellCheck={false}
          aria-label="Directory filter"
          value={draft}
          onChange={(e) => change(e.target.value, e.target.selectionStart ?? 0)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKey}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          placeholder="lang:fa and subscribers >= 10000 and not is:followed"
          className="min-w-0 flex-1 bg-transparent py-3 font-mono text-sm focus:outline-none"
        />
        {parsed ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
            <Check size={12} /> {atoms(parsed).length} conditions
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
            <TriangleAlert size={12} /> not a filter yet, the list keeps the
            last one
          </span>
        )}
      </div>
      {open && (
        <ul className="absolute top-full left-0 z-30 mt-1 max-h-80 w-[min(32rem,100%)] overflow-y-auto rounded-xl border border-app-ink/10 bg-app-card p-1 text-xs shadow-xl">
          {suggestions.map((s, i) => (
            <li key={s.text}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  accept(s)
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left ${i === active ? "bg-app-ink/10" : ""}`}
              >
                <span className="font-mono font-semibold">{s.label}</span>
                {s.hint && (
                  <span className="ml-auto truncate text-app-ink/50">
                    {s.hint}
                  </span>
                )}
              </button>
            </li>
          ))}
          <li className="px-2 pt-1 text-[10px] text-app-ink/40">
            ↑↓ to move, Enter or Tab to take, Esc to close
          </li>
        </ul>
      )}
    </div>
  )
}

export function VariantTyped() {
  const d = useDirectory()
  const { view, res } = d
  return (
    <div className="pt-4">
      <section className="mb-3 space-y-2 rounded-xl border border-app-ink/10 bg-app-card p-3 shadow-md">
        <QueryLine d={d} />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-w-72 flex-1 items-center gap-2 rounded-lg border border-app-ink/10 bg-app-muted px-2.5">
            <Search size={14} className="text-app-ink/50" />
            <input
              dir="auto"
              aria-label="Search the Directory"
              value={view.q}
              onChange={(e) => d.setQ(e.target.value)}
              placeholder="Search words"
              className="min-w-0 flex-1 bg-transparent py-2 text-sm focus:outline-none"
            />
          </label>
          <SearchFieldToggles d={d} />
          <BarToggle
            on={view.snippets}
            label="Show matches"
            title="Quote the matching post and bio while searching"
            onClick={() => d.patch({ snippets: !view.snippets })}
          />
          <KindsPill d={d} />
          <DirectorySort d={d} />
          <ColumnsPill d={d} />
          <span className="ml-auto font-mono text-[11px] text-app-ink/50">
            <b className="text-sm text-app-ink">
              {res.data ? res.data.total.toLocaleString() : "…"}
            </b>{" "}
            channels · {res.isFetching ? "loading…" : `${res.data?.ms ?? 0} ms`}
          </span>
        </div>
        <div className="-mx-3">
          <DirectoryFilterRow d={d} />
        </div>
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-app-ink/50">
          Try:
          {EXAMPLES.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => {
                const t = parseDirectory(x)
                if (t) d.setTree(t)
              }}
              className="rounded-full bg-app-ink/5 px-2 py-0.5 font-mono hover:bg-app-ink/10"
            >
              {x}
            </button>
          ))}
        </p>
        {res.error && (
          <p className="text-xs text-red-500">{String(res.error)}</p>
        )}
      </section>
      <DirectoryResults d={d} />
    </div>
  )
}
