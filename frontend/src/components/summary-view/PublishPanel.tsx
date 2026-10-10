import { AlertTriangle, Pencil, RotateCcw, Send } from "lucide-react"
import { useState } from "react"
import type {
  PublicationOptions,
  PublicationPartResponse,
  PublicationPlanResponse,
  PublicationSendRequest,
} from "@/client"
import { TgButton } from "@/components/ui/tg-button"
import { TgToggle } from "@/components/ui/tg-toggle"
import type { CitationStyle } from "@/lib/settings/schema"
import { cn } from "@/lib/utils"
import type { BotCredential, ChatDestination } from "@/types"
import {
  metadataRows,
  partsLabel,
  telegramSegments,
  withRowToggled,
} from "./publish-panel-model"

export interface PublishPanelProps {
  bots: BotCredential[]
  destinations: ChatDestination[]
  /** The server's plan for the current options; what Publish sends. */
  plan: PublicationPlanResponse | undefined
  options: Required<PublicationOptions>
  onOptionsChange: (options: Required<PublicationOptions>) => void
  /** The Summary's saved metadata; empty means the generated text. */
  metadataText: string
  onSaveMetadataText: (text: string) => Promise<void>
  citationStyle: CitationStyle
  linkPreviews: boolean
  onOpenSettings: () => void
  onPublish: (send: PublicationSendRequest) => Promise<void>
}

const LABEL = "text-[11px] font-bold uppercase tracking-widest text-app-ink/60"
const SELECT =
  "w-full rounded-lg border border-app-ink/15 bg-app-card px-2.5 py-2 text-xs focus:outline-none focus:border-app-ink/50"

const CITATION_WORDS: Record<CitationStyle, string> = {
  asWritten: "as written",
  channelName: "by Channel name",
  numbered: "numbered",
}

/**
 * The publish panel (SUMTAB-09): the action first, then the metadata options,
 * then the server's plan as Telegram will show it.
 */
export function PublishPanel(props: PublishPanelProps) {
  return (
    <section className="mt-10 rounded-2xl border border-app-ink/10 p-4 md:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Send size={14} />
        <h4 className="text-sm font-bold">Publish to Telegram</h4>
      </div>
      <PublishTarget {...props} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <MetadataOptions {...props} />
          <p className="text-xs text-app-ink/60">
            Citations {CITATION_WORDS[props.citationStyle]}, link previews{" "}
            {props.linkPreviews ? "on" : "off"}.{" "}
            <button
              type="button"
              onClick={props.onOpenSettings}
              className="underline hover:text-app-ink"
            >
              Publishing settings
            </button>
          </p>
        </div>
        <div className="min-w-0">
          <div className={cn(LABEL, "mb-2")}>What the channel receives</div>
          {props.plan && <PartsPreview plan={props.plan} />}
        </div>
      </div>
    </section>
  )
}

/** Bot and destination pickers, and the button that names what it sends. */
function PublishTarget(p: PublishPanelProps) {
  const [botId, setBotId] = useState(p.bots.length === 1 ? p.bots[0].id : "")
  const [destId, setDestId] = useState(
    p.destinations.length === 1 ? p.destinations[0].id : "",
  )
  const [sending, setSending] = useState(false)
  if (p.bots.length === 0 || p.destinations.length === 0)
    return (
      <p className="text-xs text-app-ink/60">
        Add a bot and a destination in Settings to publish.
      </p>
    )
  const dest = p.destinations.find((d) => d.id === destId)
  const publish = async () => {
    setSending(true)
    try {
      await p.onPublish({ botId, destinationId: destId, ...p.options })
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end">
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
        <Picker label="Bot" value={botId} onChange={setBotId} items={p.bots} />
        <Picker
          label="Destination"
          value={destId}
          onChange={setDestId}
          items={p.destinations}
        />
      </div>
      <TgButton
        variant="primary"
        disabled={!botId || !dest || !p.plan}
        loading={sending}
        loadingLabel="Sending…"
        onClick={publish}
      >
        {dest && p.plan
          ? `Publish ${partsLabel(p.plan.parts.length)} to ${dest.name}`
          : "Publish"}
      </TgButton>
    </div>
  )
}

function Picker(p: {
  label: string
  value: string
  onChange: (id: string) => void
  items: { id: string; name: string }[]
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{p.label}</span>
      <select
        aria-label={p.label}
        className={SELECT}
        value={p.value}
        onChange={(e) => p.onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {p.items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function Switch(p: {
  label: string
  checked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <TgToggle
        checked={p.checked}
        onClick={() => p.onChange(!p.checked)}
        aria-label={p.label}
      />
      {p.label}
    </div>
  )
}

/** The send-metadata switch, and once on, its rows, placement and text. */
function MetadataOptions(p: PublishPanelProps) {
  const { options, onOptionsChange } = p
  return (
    <>
      <Switch
        label="Send metadata"
        checked={options.includeMetadata}
        onChange={(on) => onOptionsChange({ ...options, includeMetadata: on })}
      />
      {options.includeMetadata && p.plan && (
        <div className="flex flex-col gap-2 rounded-lg bg-app-muted/20 p-3">
          <MetadataRows {...p} generated={p.plan.defaultMetadata} />
          <Switch
            label="In the first Part when it fits"
            checked={options.metadataInFirstPart}
            onChange={(on) =>
              onOptionsChange({ ...options, metadataInFirstPart: on })
            }
          />
          <MetadataText {...p} />
        </div>
      )}
    </>
  )
}

/** Each generated row with its value; a hand-written text turns them off. */
function MetadataRows(p: PublishPanelProps & { generated: string }) {
  const rows = metadataRows(p.generated, p.metadataText)
  return (
    <>
      {rows.rows.map((row) => (
        <label key={row.line} className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            disabled={rows.custom}
            checked={!rows.custom && row.sent}
            onChange={() =>
              void p.onSaveMetadataText(
                withRowToggled(rows.heading, rows.rows, row),
              )
            }
            className="mt-0.5 size-3.5 accent-app-ink disabled:opacity-30"
          />
          <span className="min-w-0">
            <span className="font-bold">{row.label}</span>{" "}
            <span className="break-words text-app-ink/50" dir="auto">
              {row.value}
            </span>
          </span>
        </label>
      ))}
      {rows.custom && (
        <p className="text-[11px] text-app-ink/60">
          Hand-written metadata; the rows are off until you reset it.
        </p>
      )}
    </>
  )
}

/** Edit as text, with Save and Reset to generated. */
function MetadataText(p: PublishPanelProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const generated = p.plan?.defaultMetadata ?? ""
  if (draft === null)
    return (
      <div className="flex flex-wrap gap-3 text-[11px]">
        <button
          type="button"
          onClick={() => setDraft(p.metadataText || generated)}
          className="flex items-center gap-1 underline"
        >
          <Pencil size={11} /> Edit as text
        </button>
        {p.metadataText && (
          <button
            type="button"
            onClick={() => void p.onSaveMetadataText("")}
            className="flex items-center gap-1 underline"
          >
            <RotateCcw size={11} /> Reset to generated
          </button>
        )}
      </div>
    )
  return (
    <div className="flex flex-col gap-2">
      <textarea
        aria-label="Metadata text"
        dir="auto"
        rows={7}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="w-full rounded-lg border border-app-ink/15 bg-transparent p-3 font-mono text-xs focus:outline-none focus:border-app-ink/50"
      />
      <div className="flex flex-wrap gap-2">
        <TgButton
          size="sm"
          variant="primary"
          onClick={async () => {
            await p.onSaveMetadataText(draft === generated ? "" : draft)
            setDraft(null)
          }}
        >
          Save
        </TgButton>
        <TgButton size="sm" variant="ghost" onClick={() => setDraft(null)}>
          Cancel
        </TgButton>
        <TgButton
          size="sm"
          variant="ghost"
          onClick={async () => {
            await p.onSaveMetadataText("")
            setDraft(null)
          }}
        >
          <RotateCcw size={12} /> Reset to generated
        </TgButton>
      </div>
    </div>
  )
}

const KIND_LABEL: Record<PublicationPartResponse["kind"], string> = {
  metadata: "metadata",
  summary: "summary",
  both: "metadata + summary",
}

/** One bubble per Part, in the order Telegram receives them. */
function PartsPreview({ plan }: { plan: PublicationPlanResponse }) {
  const count = plan.parts.length
  return (
    <ol className="flex max-h-[40rem] flex-col gap-3 overflow-y-auto overscroll-contain pr-1">
      {plan.parts.map((part, i) => (
        <li key={`${part.kind}-${i}`}>
          <div className="mb-1 flex flex-wrap items-center gap-x-2 text-[10px] font-mono text-app-ink/50">
            <span className="font-bold text-app-ink/70">
              {i + 1} / {count}
            </span>
            <span>{KIND_LABEL[part.kind]}</span>
            <span>
              {part.length.toLocaleString("en-US")} /{" "}
              {plan.limit.toLocaleString("en-US")}
            </span>
            {part.cutInside && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle size={10} /> cut inside a word
              </span>
            )}
          </div>
          <div
            dir="auto"
            className="max-h-44 overflow-y-auto overscroll-contain rounded-2xl rounded-tl-sm bg-sky-500/10 px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words"
          >
            <TelegramText text={part.text} />
          </div>
        </li>
      ))}
    </ol>
  )
}

/** A Part's text drawn the way the server's entity parser sends it. */
function TelegramText({ text }: { text: string }) {
  return (
    <>
      {telegramSegments(text).map((s, i) => {
        const key = `${i}-${s.kind}`
        if (s.kind === "bold") return <b key={key}>{s.text}</b>
        if (s.kind === "italic") return <i key={key}>{s.text}</i>
        if (s.kind === "link")
          return (
            <a
              key={key}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="text-sky-600 underline dark:text-sky-400"
            >
              {s.text}
            </a>
          )
        return <span key={key}>{s.text}</span>
      })}
    </>
  )
}
