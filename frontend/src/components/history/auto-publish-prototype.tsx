// PROTOTYPE, never merge: four looks for a History card's Auto-publish target,
// switched by `?variant=` on the History tab. 0 is the branch as it stands.
// Picks live in memory only (nothing is written to the server), so every
// variant starts from what the list says is saved and forgets on reload.
import { AlertTriangle, Check, ChevronDown, Send } from "lucide-react"
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
} from "react"
import { BarPopover } from "@/components/BarPopover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TgButton } from "@/components/ui/tg-button"
import type { ArtifactListItem } from "@/types"
import { type ArtifactActions, PublishTargetLine } from "./ArtifactCardParts"

export const VARIANTS = [
  { key: "0", name: "Current" },
  { key: "A", name: "Chip and popover" },
  { key: "B", name: "Panel with pills" },
  { key: "C", name: "Sentence, chat first" },
]

export const VariantContext = createContext("0")
export const useVariant = () => useContext(VariantContext)

// ---- the in-memory store ----------------------------------------------------

type Pick = { bot: string; chat: string }
const picks = new Map<string, Pick>()
const listeners = new Set<() => void>()
let version = 0

export function setPick(id: string, bot: string, chat: string) {
  picks.set(id, { bot, chat })
  version++
  for (const l of listeners) l()
}

function usePick(artifact: ArtifactListItem): Pick {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
  )
  const saved =
    artifact.kind === "summary"
      ? { bot: artifact.publishBotId ?? "", chat: artifact.publishChatId ?? "" }
      : { bot: "", chat: "" }
  return picks.get(`${artifact.kind}:${artifact.id}`) ?? saved
}

// ---- shared bits ------------------------------------------------------------

type Target = ArtifactActions["publishTarget"]
type Props = { artifact: ArtifactListItem; target: Target }

const nameOf = (list: readonly { id: string; name: string }[], id: string) =>
  list.find((x) => x.id === id)?.name ?? (id ? "(deleted)" : "")

const shows = (a: ArtifactListItem) => a.kind === "summary" && a.autoPublish

/** The header chip; A replaces it with its own, the others keep the plain one. */
export function PublishChip({ artifact, target }: Props) {
  const variant = useVariant()
  const pick = usePick(artifact)
  if (!shows(artifact)) return null
  if (variant === "A")
    return <ChipPopover artifact={artifact} target={target} />
  const ready = pick.bot && pick.chat
  if (variant === "0" || ready)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-700 dark:text-blue-300">
        <Send size={11} /> Auto-publishes
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-800 dark:text-amber-300">
      <AlertTriangle size={11} /> Auto-publish has no target
    </span>
  )
}

/** The body line under the title: 0, B and C. */
export function PublishBody({ artifact, target }: Props) {
  const variant = useVariant()
  if (!shows(artifact)) return null
  if (variant === "0") return <Current artifact={artifact} target={target} />
  if (variant === "B") return <Panel artifact={artifact} target={target} />
  if (variant === "C") return <Sentence artifact={artifact} target={target} />
  return null
}

// ---- 0: the branch's line, fed from the store -------------------------------

function Current({ artifact, target }: Props) {
  const pick = usePick(artifact)
  return (
    <PublishTargetLine
      artifact={
        {
          ...artifact,
          publishBotId: pick.bot,
          publishChatId: pick.chat,
        } as ArtifactListItem
      }
      target={target}
    />
  )
}

// ---- A: the header chip says where, a popover changes it --------------------

function ChipPopover({ artifact, target }: Props) {
  const pick = usePick(artifact)
  const [open, setOpen] = useState(false)
  const ready = pick.bot && pick.chat
  const choose = (bot: string, chat: string) => target.set(artifact, bot, chat)
  return (
    <BarPopover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          className={`inline-flex max-w-64 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
            ready
              ? "bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300"
              : "bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/40 hover:bg-amber-500/25 dark:text-amber-300"
          }`}
        >
          {ready ? <Send size={11} /> : <AlertTriangle size={11} />}
          <span className="truncate">
            {ready
              ? `Auto-publishes to ${nameOf(target.destinations, pick.chat)}`
              : "Auto-publish: choose where"}
          </span>
          <ChevronDown size={11} className="shrink-0 opacity-60" />
        </button>
      }
    >
      <div className="w-64 space-y-3 p-1 text-xs">
        <PickList
          title="Send to"
          items={target.destinations}
          value={pick.chat}
          onPick={(chat) => choose(pick.bot, chat)}
          empty="No chats yet. Add one under Tools, Destinations."
        />
        <PickList
          title="As bot"
          items={target.bots}
          value={pick.bot}
          onPick={(bot) => choose(bot, pick.chat)}
          empty="No bots yet. Add one under Tools, Bots."
        />
        <div className="flex justify-end">
          <TgButton size="sm" onClick={() => setOpen(false)}>
            Done
          </TgButton>
        </div>
      </div>
    </BarPopover>
  )
}

function PickList({
  title,
  items,
  value,
  onPick,
  empty,
}: {
  title: string
  items: readonly { id: string; name: string }[]
  value: string
  onPick: (id: string) => void
  empty: string
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-app-ink/50">
        {title}
      </p>
      {items.length === 0 && <p className="text-app-ink/50">{empty}</p>}
      <div className="max-h-40 overflow-y-auto">
        {items.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => onPick(x.id)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-app-ink/10 ${
              x.id === value ? "font-semibold" : ""
            }`}
          >
            <Check size={12} className={x.id === value ? "" : "invisible"} />
            <span className="truncate">{x.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---- B: a tinted panel, every choice visible as a pill ----------------------

function Panel({ artifact, target }: Props) {
  const pick = usePick(artifact)
  const ready = pick.bot && pick.chat
  return (
    <section
      className={`min-w-0 rounded-lg border px-3 py-2 text-[11px] ${
        ready
          ? "border-blue-500/20 bg-blue-500/5"
          : "border-amber-500/40 bg-amber-500/5"
      }`}
    >
      <header className="mb-1.5 flex items-center gap-1.5 font-semibold text-app-ink/70">
        <Send size={12} /> Auto-publish
        <span
          className={`ml-auto rounded-full px-1.5 py-px text-[10px] ${
            ready
              ? "bg-green-500/15 text-green-700 dark:text-green-300"
              : "bg-amber-500/20 text-amber-800 dark:text-amber-300"
          }`}
        >
          {ready
            ? "Ready"
            : !pick.bot && !pick.chat
              ? "Needs a bot and a chat"
              : !pick.bot
                ? "Needs a bot"
                : "Needs a chat"}
        </span>
      </header>
      <PillRow
        label="Chat"
        items={target.destinations}
        value={pick.chat}
        onPick={(chat) => target.set(artifact, pick.bot, chat)}
      />
      <PillRow
        label="Bot"
        items={target.bots}
        value={pick.bot}
        onPick={(bot) => target.set(artifact, bot, pick.chat)}
      />
    </section>
  )
}

function PillRow({
  label,
  items,
  value,
  onPick,
}: {
  label: string
  items: readonly { id: string; name: string }[]
  value: string
  onPick: (id: string) => void
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 py-0.5">
      <span className="w-8 shrink-0 text-app-ink/50">{label}</span>
      <div className="flex min-w-0 flex-wrap gap-1">
        {items.length === 0 && (
          <span className="text-app-ink/40">none saved</span>
        )}
        {items.map((x) => (
          <button
            key={x.id}
            type="button"
            aria-pressed={x.id === value}
            onClick={() => onPick(x.id === value ? "" : x.id)}
            className={`max-w-40 truncate rounded-full border px-2 py-0.5 ${
              x.id === value
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-app-ink/15 text-app-ink/70 hover:border-app-ink/40"
            }`}
          >
            {x.name}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---- C: one sentence, the chat first, each half a dropdown chip -------------

function Sentence({ artifact, target }: Props) {
  const pick = usePick(artifact)
  const ready = pick.bot && pick.chat
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-1 text-[12px] text-app-ink/60">
      <span
        className={`size-2 shrink-0 rounded-full ${ready ? "bg-green-500" : "bg-amber-500"}`}
        title={ready ? "Ready" : "Nothing is sent until both are chosen"}
      />
      Sends to
      <ChipMenu
        label="Chat"
        placeholder="choose a chat"
        items={target.destinations}
        value={pick.chat}
        onPick={(chat) => target.set(artifact, pick.bot, chat)}
      />
      as
      <ChipMenu
        label="Bot"
        placeholder="choose a bot"
        items={target.bots}
        value={pick.bot}
        onPick={(bot) => target.set(artifact, bot, pick.chat)}
      />
    </p>
  )
}

function ChipMenu({
  label,
  placeholder,
  items,
  value,
  onPick,
}: {
  label: string
  placeholder: string
  items: readonly { id: string; name: string }[]
  value: string
  onPick: (id: string) => void
}) {
  const name = nameOf(items, value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`inline-flex max-w-44 items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium ${
            value
              ? "bg-app-ink/8 text-app-ink hover:bg-app-ink/15"
              : "border border-dashed border-amber-500/70 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
          }`}
        >
          <span className="truncate">{name || placeholder}</span>
          <ChevronDown size={12} className="shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="text-xs">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {items.length === 0 && (
          <p className="px-2 py-1 text-app-ink/50">None saved yet</p>
        )}
        <DropdownMenuRadioGroup value={value} onValueChange={onPick}>
          {items.map((x) => (
            <DropdownMenuRadioItem key={x.id} value={x.id}>
              {x.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---- the switcher -----------------------------------------------------------

export { PrototypeSwitcher } from "./PrototypeSwitcher"
