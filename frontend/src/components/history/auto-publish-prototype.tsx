// PROTOTYPE, never merge: a History card's Auto-publish target, switched by
// `?variant=` on the History tab. 0 is the branch as it stands; A won the first
// round (a header chip that opens a popover), and A to A4 try the popover's
// inside. Picks live in memory only (nothing is written to the server), so
// every variant starts from what the list says is saved and forgets on reload.
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  MessageCircle,
  Search,
  Send,
} from "lucide-react"
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
} from "react"
import { BarPopover } from "@/components/BarPopover"
import { TgButton } from "@/components/ui/tg-button"
import type { ArtifactListItem, BotCredential, ChatDestination } from "@/types"
import { type ArtifactActions, PublishTargetLine } from "./ArtifactCardParts"

export const VARIANTS = [
  { key: "0", name: "Current" },
  { key: "A", name: "Popover: two lists" },
  { key: "A2", name: "Popover: chat, then bot" },
  { key: "A3", name: "Popover: search pairs" },
  { key: "A4", name: "Popover: side by side" },
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
/** What a popover's inside gets: the pick, a setter, and a way to close. */
type Inside = {
  pick: Pick
  bots: readonly BotCredential[]
  chats: readonly ChatDestination[]
  choose: (bot: string, chat: string) => void
  close: () => void
}

const nameOf = (list: readonly { id: string; name: string }[], id: string) =>
  list.find((x) => x.id === id)?.name ?? (id ? "(deleted)" : "")

const shows = (a: ArtifactListItem) => a.kind === "summary" && a.autoPublish

const NO_CHATS = "No chats yet. Add one under Tools, Destinations."
const NO_BOTS = "No bots yet. Add one under Tools, Bots."

/** The header chip: plain on 0, the popover's trigger on every A. */
export function PublishChip({ artifact, target }: Props) {
  const variant = useVariant()
  if (!shows(artifact)) return null
  if (variant.startsWith("A"))
    return <ChipPopover artifact={artifact} target={target} variant={variant} />
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-700 dark:text-blue-300">
      <Send size={11} /> Auto-publishes
    </span>
  )
}

/** The body line under the title: only 0 has one. */
export function PublishBody({ artifact, target }: Props) {
  const variant = useVariant()
  if (!shows(artifact) || variant !== "0") return null
  return <Current artifact={artifact} target={target} />
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

// ---- A: the chip, and the popover whose inside the variant picks ------------

function ChipPopover({
  artifact,
  target,
  variant,
}: Props & { variant: string }) {
  const pick = usePick(artifact)
  const [open, setOpen] = useState(false)
  const ready = pick.bot && pick.chat
  const inside: Inside = {
    pick,
    bots: target.bots,
    chats: target.destinations,
    choose: (bot, chat) => target.set(artifact, bot, chat),
    close: () => setOpen(false),
  }
  return (
    <BarPopover
      open={open}
      onOpenChange={setOpen}
      width={
        variant === "A4" ? "w-[28rem]" : variant === "A3" ? "w-80" : "w-64"
      }
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
      {variant === "A2" ? (
        <Steps {...inside} />
      ) : variant === "A3" ? (
        <Pairs {...inside} />
      ) : variant === "A4" ? (
        <SideBySide {...inside} />
      ) : (
        <TwoLists {...inside} />
      )}
    </BarPopover>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-app-ink/50">
      {children}
    </p>
  )
}

/** One choosable row: a check, the name, and an optional second line. */
function Row({
  on,
  name,
  detail,
  onClick,
}: {
  on: boolean
  name: string
  detail?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-app-ink/10 ${
        on ? "bg-app-ink/5 font-semibold" : ""
      }`}
    >
      <Check size={12} className={`shrink-0 ${on ? "" : "invisible"}`} />
      <span className="min-w-0">
        <span dir="auto" className="block truncate">
          {name}
        </span>
        {detail && (
          <span className="block truncate font-mono text-[10px] font-normal text-app-ink/45">
            {detail}
          </span>
        )}
      </span>
    </button>
  )
}

// ---- A: two stacked lists and Done (round one's winner, unchanged) ----------

function TwoLists({ pick, bots, chats, choose, close }: Inside) {
  return (
    <div className="space-y-3 text-xs">
      <div>
        <Heading>Send to</Heading>
        {chats.length === 0 && <p className="text-app-ink/50">{NO_CHATS}</p>}
        <div className="max-h-40 overflow-y-auto">
          {chats.map((c) => (
            <Row
              key={c.id}
              on={c.id === pick.chat}
              name={c.name}
              onClick={() => choose(pick.bot, c.id)}
            />
          ))}
        </div>
      </div>
      <div>
        <Heading>As bot</Heading>
        {bots.length === 0 && <p className="text-app-ink/50">{NO_BOTS}</p>}
        {bots.map((b) => (
          <Row
            key={b.id}
            on={b.id === pick.bot}
            name={b.name}
            onClick={() => choose(b.id, pick.chat)}
          />
        ))}
      </div>
      <div className="flex justify-end">
        <TgButton size="sm" onClick={close}>
          Done
        </TgButton>
      </div>
    </div>
  )
}

// ---- A2: one question at a time; a lone bot is chosen for you ---------------

function Steps({ pick, bots, chats, choose, close }: Inside) {
  const [step, setStep] = useState<"chat" | "bot">("chat")
  const onlyBot = bots.length === 1 ? bots[0].id : ""
  const pickChat = (chat: string) => {
    if (onlyBot) {
      choose(onlyBot, chat)
      close()
      return
    }
    choose(pick.bot, chat)
    setStep("bot")
  }
  return (
    <div className="text-xs">
      <div className="mb-2 flex items-center gap-1.5">
        {step === "bot" && (
          <button
            type="button"
            aria-label="Back to the chat"
            onClick={() => setStep("chat")}
            className="rounded p-0.5 hover:bg-app-ink/10"
          >
            <ArrowLeft size={13} />
          </button>
        )}
        <p className="font-semibold">
          {step === "chat" ? "Where should it go?" : "Which bot sends it?"}
        </p>
        {!onlyBot && (
          <span className="ml-auto text-[10px] text-app-ink/45">
            {step === "chat" ? "1" : "2"} of 2
          </span>
        )}
      </div>
      {step === "chat" ? (
        <>
          {chats.length === 0 && <p className="text-app-ink/50">{NO_CHATS}</p>}
          <div className="max-h-56 overflow-y-auto">
            {chats.map((c) => (
              <Row
                key={c.id}
                on={c.id === pick.chat}
                name={c.name}
                detail={c.chatId}
                onClick={() => pickChat(c.id)}
              />
            ))}
          </div>
          {onlyBot && (
            <p className="mt-2 border-t border-app-ink/10 pt-2 text-[11px] text-app-ink/50">
              Sent by {nameOf(bots, onlyBot)}, your only bot.
            </p>
          )}
        </>
      ) : (
        <>
          {bots.length === 0 && <p className="text-app-ink/50">{NO_BOTS}</p>}
          {bots.map((b) => (
            <Row
              key={b.id}
              on={b.id === pick.bot}
              name={b.name}
              onClick={() => {
                choose(b.id, pick.chat)
                close()
              }}
            />
          ))}
        </>
      )}
    </div>
  )
}

// ---- A3: a search over every chat-and-bot pair, one click sets both ---------

function Pairs({ pick, bots, chats, choose, close }: Inside) {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const pairs = chats
    .flatMap((c) => bots.map((b) => ({ c, b })))
    .filter(
      ({ c, b }) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.chatId.toLowerCase().includes(q) ||
        b.name.toLowerCase().includes(q),
    )
  return (
    <div className="text-xs">
      <label className="mb-2 flex items-center gap-1.5 rounded-md border border-app-ink/15 bg-app-muted px-2 py-1 focus-within:border-app-ink/40">
        <Search size={12} className="opacity-50" />
        <input
          // biome-ignore lint/a11y/noAutofocus: the popover opens to search.
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chats and bots"
          aria-label="Search chats and bots"
          className="min-w-0 flex-1 bg-transparent outline-none"
        />
      </label>
      {chats.length === 0 && <p className="text-app-ink/50">{NO_CHATS}</p>}
      {bots.length === 0 && <p className="text-app-ink/50">{NO_BOTS}</p>}
      {chats.length > 0 && bots.length > 0 && pairs.length === 0 && (
        <p className="px-2 py-1 text-app-ink/50">Nothing matches.</p>
      )}
      <div className="max-h-60 overflow-y-auto">
        {pairs.map(({ c, b }) => (
          <Row
            key={`${c.id}:${b.id}`}
            on={c.id === pick.chat && b.id === pick.bot}
            name={c.name}
            detail={`via ${b.name}`}
            onClick={() => {
              choose(b.id, c.id)
              close()
            }}
          />
        ))}
      </div>
    </div>
  )
}

// ---- A4: chats and bots side by side, under a sentence of what will happen --

function SideBySide({ pick, bots, chats, choose, close }: Inside) {
  const chat = nameOf(chats, pick.chat)
  const bot = nameOf(bots, pick.bot)
  return (
    <div className="text-xs">
      <p
        className={`mb-2 rounded-md px-2 py-1.5 ${
          chat && bot
            ? "bg-blue-500/10 text-blue-800 dark:text-blue-200"
            : "bg-amber-500/10 text-amber-800 dark:text-amber-300"
        }`}
      >
        {chat && bot ? (
          <>
            Each new version goes to <b dir="auto">{chat}</b>, sent by{" "}
            <b>{bot}</b>.
          </>
        ) : (
          "Choose a chat and a bot. Until then nothing is sent."
        )}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0">
          <Heading>
            <MessageCircle size={10} className="mr-1 inline" />
            Chat
          </Heading>
          {chats.length === 0 && <p className="text-app-ink/50">{NO_CHATS}</p>}
          <div className="max-h-52 overflow-y-auto">
            {chats.map((c) => (
              <Row
                key={c.id}
                on={c.id === pick.chat}
                name={c.name}
                detail={c.chatId}
                onClick={() => choose(pick.bot, c.id)}
              />
            ))}
          </div>
        </div>
        <div className="min-w-0 border-l border-app-ink/10 pl-2">
          <Heading>
            <Bot size={10} className="mr-1 inline" />
            Bot
          </Heading>
          {bots.length === 0 && <p className="text-app-ink/50">{NO_BOTS}</p>}
          {bots.map((b) => (
            <Row
              key={b.id}
              on={b.id === pick.bot}
              name={b.name}
              onClick={() => choose(b.id, pick.chat)}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <TgButton size="sm" onClick={close}>
          Done
        </TgButton>
      </div>
    </div>
  )
}

export { PrototypeSwitcher } from "./PrototypeSwitcher"
