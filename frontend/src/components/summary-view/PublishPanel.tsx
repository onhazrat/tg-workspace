import { AlertTriangle, Pencil, RotateCcw, Send } from "lucide-react"
import { useState } from "react"
import type {
  PartialPublicationResponse,
  PublicationOptions,
  PublicationPartResponse,
  PublicationPlanResponse,
  PublicationSendRequest,
} from "@/client"
import { TgButton } from "@/components/ui/tg-button"
import { TgToggle } from "@/components/ui/tg-toggle"
import { useKindGate } from "@/hooks/useRequestKinds"
import { CITATION_STYLES, type CitationStyle } from "@/lib/settings/schema"
import { cn } from "@/lib/utils"
import type { BotCredential, ChatDestination, PublishingOptions } from "@/types"
import { omittedAfterToggle, partsLabel } from "./publish-panel-model"
import { TimeZoneInput } from "./TimeZoneInput"

export interface PublishPanelProps {
  bots: BotCredential[]
  destinations: ChatDestination[]
  /** The server's plan for the current options; what Publish sends. */
  plan: PublicationPlanResponse | undefined
  options: Required<PublicationOptions>
  onOptionsChange: (options: Required<PublicationOptions>) => void
  /** The Summary's hand-written metadata; empty means the generated rows. */
  metadataText: string
  onSaveMetadataText: (text: string) => Promise<void>
  /** Save the keys of the generated rows the Summary leaves out. */
  onSaveOmittedRows: (keys: string[]) => Promise<void>
  /** What this Summary publishes with: Settings, under its own changes. */
  publishing: PublishingOptions
  /** The Summary changed at least one option from Settings. */
  publishingCustomized: boolean
  onPublishingChange: (change: Partial<PublishingOptions>) => void
  /** Drop the Summary's changes; it follows Settings again. */
  onPublishingReset: () => void
  onOpenSettings: () => void
  onPublish: (send: PublicationSendRequest) => Promise<void>
}

const LABEL = "text-[11px] font-bold uppercase tracking-widest text-app-ink/60"
const SELECT =
  "w-full rounded-lg border border-app-ink/15 bg-app-card px-2.5 py-2 text-xs focus:outline-none focus:border-app-ink/50"

/** Each citation style as a sample of how it reads. */
const CITATION_SAMPLES: Record<CitationStyle, string> = {
  asWritten: "[chan #id]",
  channelName: "(chan, chan)",
  numbered: "[1][2]",
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
      {props.plan?.partial && (
        <FinishPartial
          partial={props.plan.partial}
          onPublish={props.onPublish}
        />
      )}
      <PublishTarget {...props} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <MetadataOptions {...props} />
          <PublishingControls {...props} />
        </div>
        <div className="min-w-0">
          <div className={cn(LABEL, "mb-2")}>What the channel receives</div>
          {props.plan && (
            <PartsPreview
              plan={props.plan}
              linkPreviews={props.publishing.linkPreviews}
            />
          )}
        </div>
      </div>
    </section>
  )
}

const loneId = (items: { id: string }[]) =>
  items.length === 1 ? items[0].id : ""

/** Bot and destination pickers, and the button that names what it sends. */
function PublishTarget(p: PublishPanelProps) {
  const [pickedBot, setBotId] = useState("")
  const [pickedDest, setDestId] = useState("")
  const [sending, setSending] = useState(false)
  // A lone one is chosen whenever it arrives, the query answering after mount
  // included; a pick made by hand wins.
  const botId = pickedBot || loneId(p.bots)
  const destId = pickedDest || loneId(p.destinations)
  const dest = p.destinations.find((d) => d.id === destId)
  const gate = useKindGate("botApi", !botId || !dest || !p.plan)
  if (p.bots.length === 0 || p.destinations.length === 0)
    return (
      <p className="text-xs text-app-ink/60">
        Add a bot and a destination in Settings to publish.
      </p>
    )
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
        {...gate}
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

/** The last Publication stopped partway: send what it did not (SUMTAB-10). */
function FinishPartial(p: {
  partial: PartialPublicationResponse
  onPublish: PublishPanelProps["onPublish"]
}) {
  const [sending, setSending] = useState(false)
  const { id, partsSent, partsTotal } = p.partial
  const send = async () => {
    setSending(true)
    try {
      await p.onPublish({ publicationId: id })
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg bg-amber-500/10 p-3 text-xs md:flex-row md:items-center md:justify-between">
      <span className="flex items-center gap-1.5">
        <AlertTriangle size={12} className="text-amber-600" />
        Last Publication was partial: {partsSent} of {partsTotal} Parts sent
      </span>
      <TgButton
        size="sm"
        variant="primary"
        loading={sending}
        loadingLabel="Sending…"
        onClick={send}
      >
        Send the remaining {partsTotal - partsSent}
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
          <MetadataRows {...p} rows={p.plan.metadataRows} />
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
function MetadataRows(
  p: PublishPanelProps & { rows: PublicationPlanResponse["metadataRows"] },
) {
  const custom = p.metadataText !== ""
  return (
    <>
      {p.rows.map((row) => (
        <label key={row.key} className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            disabled={custom}
            checked={!custom && row.sent}
            onChange={() =>
              void p.onSaveOmittedRows(omittedAfterToggle(p.rows, row.key))
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
      {custom && (
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

/**
 * Settings' Publication Options, copied here for this Summary: Settings is the
 * default, a change here is this Summary's alone, scheduled sends included.
 */
function PublishingControls(p: PublishPanelProps) {
  const { publishing, onPublishingChange } = p
  return (
    <>
      <Switch
        label="Link previews"
        checked={publishing.linkPreviews}
        onChange={(on) => onPublishingChange({ linkPreviews: on })}
      />
      <details className="group rounded-lg border border-app-ink/10 px-3 py-2">
        <summary className="cursor-pointer list-none text-xs">
          <span className="font-bold">Formatting</span>{" "}
          <span className="text-app-ink/50">
            · citations{" "}
            <span className="font-mono">
              {CITATION_SAMPLES[publishing.citationStyle]}
            </span>{" "}
            · {publishing.timeZone || "UTC"}
          </span>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs">Citations</span>
            <div className="flex flex-wrap gap-1">
              {CITATION_STYLES.map((style) => (
                <button
                  key={style}
                  type="button"
                  aria-pressed={publishing.citationStyle === style}
                  onClick={() => onPublishingChange({ citationStyle: style })}
                  className={cn(
                    "rounded-md border px-2 py-1 font-mono text-[11px]",
                    publishing.citationStyle === style
                      ? "border-app-ink bg-app-ink text-app-bg"
                      : "border-app-ink/15 hover:border-app-ink/40",
                  )}
                >
                  {CITATION_SAMPLES[style]}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs">Time zone of the metadata</span>
            <TimeZoneInput
              key={publishing.timeZone}
              id="summary-publishing-time-zone"
              timeZone={publishing.timeZone}
              onTimeZone={(zone) => onPublishingChange({ timeZone: zone })}
              className={cn(SELECT, "font-sans tracking-normal")}
            />
          </label>
        </div>
      </details>
      <p className="text-[11px] text-app-ink/60">
        {p.publishingCustomized
          ? "Changed for this Summary. "
          : "Your defaults from "}
        {p.publishingCustomized && (
          <>
            <button
              type="button"
              onClick={p.onPublishingReset}
              className="underline hover:text-app-ink"
            >
              Use my defaults
            </button>
            {" · "}
          </>
        )}
        <button
          type="button"
          onClick={p.onOpenSettings}
          className="underline hover:text-app-ink"
        >
          Publishing settings
        </button>
      </p>
    </>
  )
}

const KIND_LABEL: Record<PublicationPartResponse["kind"], string> = {
  metadata: "metadata",
  summary: "summary",
  both: "metadata + summary",
}

/** One bubble per Part, in the order Telegram receives them. */
function PartsPreview({
  plan,
  linkPreviews,
}: {
  plan: PublicationPlanResponse
  linkPreviews: boolean
}) {
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
            <TelegramText segments={part.segments} />
          </div>
          {linkPreviews && <PreviewCard segments={part.segments} />}
        </li>
      ))}
    </ol>
  )
}

/** Stands in for the card Telegram draws under a Part's first link. */
function PreviewCard({
  segments,
}: {
  segments: PublicationPartResponse["segments"]
}) {
  const url = segments.find((s) => s.kind === "link")?.url
  if (!url) return null
  return (
    <div className="mt-1 ml-3 border-l-2 border-sky-500 pl-2 text-[11px] text-app-ink/60">
      <div className="font-bold text-sky-700 dark:text-sky-300">
        Link preview
      </div>
      <div className="truncate font-mono">
        {url.replace(/^https?:\/\//, "")}
      </div>
    </div>
  )
}

/** A Part drawn from the segments the server parsed it into for the send. */
function TelegramText({
  segments,
}: {
  segments: PublicationPartResponse["segments"]
}) {
  return (
    <>
      {segments.map((s, i) => {
        const key = `${i}-${s.kind}`
        if (s.kind === "bold") return <b key={key}>{s.text}</b>
        if (s.kind === "italic") return <i key={key}>{s.text}</i>
        if (s.kind === "link")
          return (
            <a
              key={key}
              href={s.url ?? undefined}
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
