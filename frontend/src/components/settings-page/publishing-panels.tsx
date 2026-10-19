/**
 * The Publishing topic's bots and destinations (SET-03), at parity with the
 * old bot management panel: the name looked up from a token or chat id while
 * it is typed, a Check per row, and a test message per destination. The
 * calls are `usePublishing`'s; the views here take props only.
 */
import { Loader2 } from "lucide-react"
import { useState } from "react"
import { BotAvatar } from "@/components/BotAvatar"
import { RelativeTime } from "@/components/RelativeTime"
import { TgButton } from "@/components/ui/tg-button"
import { usePublishLogsQuery } from "@/hooks/useLogs"
import { usePublishing } from "@/hooks/usePublishing"
import type { BotValidation, DestValidation } from "@/lib/bots/publishing-model"
import type { BotCredential, ChatDestination, PublishLog } from "@/types"
import {
  ConfirmButton,
  cellClass,
  errorOf,
  FormError,
  FormInput,
  FormPill,
  ListTable,
  RowAction,
  rowClass,
  Status,
} from "./kit"

type LookUp = (typed: string, currentName: string) => Promise<string | null>

/**
 * The add form both tables open: an id field that looks the name up as it is
 * typed, a name field, and Save. A lookup never overwrites a typed name;
 * `autofillName` answers null for that.
 */
function AddForm({
  pill,
  heading,
  idLabel,
  idPlaceholder,
  secret,
  nameLabel,
  saveLabel,
  onLookUp,
  onAdd,
}: {
  pill: string
  heading: string
  idLabel: string
  idPlaceholder: string
  secret?: boolean
  nameLabel: string
  saveLabel: string
  onLookUp: LookUp
  onAdd: (id: string, name: string) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [id, setId] = useState("")
  const [name, setName] = useState("")
  const [looking, setLooking] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const typeId = async (value: string) => {
    setId(value)
    setLooking(true)
    const found = await onLookUp(value, name)
    setLooking(false)
    if (found) setName((typed) => typed || found)
  }
  const save = async () => {
    setBusy(true)
    setError("")
    try {
      await onAdd(id.trim(), name.trim())
      setId("")
      setName("")
      setOpen(false)
    } catch (e) {
      setError(errorOf(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <FormPill label={pill} heading={heading} open={open} onOpenChange={setOpen}>
      <FormInput
        type={secret ? "password" : "text"}
        label={idLabel}
        placeholder={idPlaceholder}
        value={id}
        onChange={(v) => void typeId(v)}
        className="font-mono"
      />
      <FormInput
        label={nameLabel}
        placeholder={looking ? "Looking up…" : "Name, or looked up"}
        value={name}
        onChange={setName}
      />
      <FormError>{error}</FormError>
      <TgButton
        size="sm"
        loading={busy}
        disabled={!id.trim()}
        onClick={() => void save()}
      >
        {saveLabel}
      </TgButton>
    </FormPill>
  )
}

/** A check's answer, or what is known without one. */
function CheckStatus({
  validation,
  info,
  lastChecked,
}: {
  validation: { isValid: boolean; loading: boolean } | undefined
  info: string | undefined
  lastChecked?: number
}) {
  if (validation?.loading) return <Status tone="off">Checking…</Status>
  if (validation)
    return (
      <Status tone={validation.isValid ? "ok" : "bad"}>
        {info || (validation.isValid ? "Valid" : "Invalid")}
      </Status>
    )
  if (lastChecked)
    return (
      <Status tone="ok">
        Checked <RelativeTime timestamp={lastChecked} />
      </Status>
    )
  return <Status tone="off">Not checked</Status>
}

export function BotsView({
  bots,
  sent,
  validation,
  onLookUp,
  onAdd,
  onCheck,
  onDelete,
}: {
  bots: BotCredential[]
  /** Messages each bot sent successfully, from the publish log. */
  sent: Record<string, number>
  validation: Record<string, BotValidation>
  onLookUp: LookUp
  onAdd: (token: string, name: string) => Promise<unknown>
  onCheck: (id: string) => void
  onDelete: (id: string) => Promise<unknown>
}) {
  return (
    <div className="space-y-2">
      <AddForm
        pill="Add bot"
        heading="A bot token from @BotFather; the name is looked up"
        idLabel="Bot token"
        idPlaceholder="123456:ABC-…"
        secret
        nameLabel="Bot name"
        saveLabel="Save bot"
        onLookUp={onLookUp}
        onAdd={onAdd}
      />
      <ListTable
        columns={[
          { label: "Bot" },
          { label: "Status" },
          { label: "Sent", className: "text-right" },
          { label: "" },
        ]}
        isEmpty={!bots.length}
        empty="No bots yet. Publishing needs one."
      >
        {bots.map((b) => (
          <tr key={b.id} className={rowClass}>
            <td className={cellClass}>
              <span className="flex items-center gap-2">
                <BotAvatar bot={b} className="h-6 w-6" />
                <span className="font-semibold">{b.name}</span>
                {b.username && (
                  <span className="text-app-ink/50">@{b.username}</span>
                )}
              </span>
            </td>
            <td className={cellClass}>
              <CheckStatus
                validation={validation[b.id]}
                info={validation[b.id]?.botInfo}
                lastChecked={b.lastValidated ?? undefined}
              />
            </td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {sent[b.id] ?? 0}
            </td>
            <td className={`${cellClass} whitespace-nowrap text-right`}>
              <span className="inline-flex items-center gap-1">
                <RowAction
                  label={`Check ${b.name}`}
                  disabled={validation[b.id]?.loading}
                  onClick={() => onCheck(b.id)}
                >
                  Check
                </RowAction>
                <ConfirmButton
                  label={`Delete ${b.name}`}
                  title={`Delete ${b.name}?`}
                  description="Summaries set to publish with it fail to publish."
                  confirmLabel="Delete"
                  onConfirm={() => onDelete(b.id)}
                />
              </span>
            </td>
          </tr>
        ))}
      </ListTable>
    </div>
  )
}

/** Messages each bot sent successfully, from the publish log. */
export function sentByBot(logs: PublishLog[]): Record<string, number> {
  const sent: Record<string, number> = {}
  for (const log of logs)
    if (log.status === "success" && log.botId)
      sent[log.botId] = (sent[log.botId] ?? 0) + 1
  return sent
}

export function Bots() {
  const p = usePublishing()
  const logs = usePublishLogsQuery(true).data ?? []
  const [validation, setValidation] = useState<Record<string, BotValidation>>(
    {},
  )
  const check = async (id: string) => {
    setValidation((v) => ({ ...v, [id]: { isValid: false, loading: true } }))
    const result = await p.checkBot(id)
    setValidation((v) => ({ ...v, [id]: result }))
  }
  return (
    <BotsView
      bots={p.bots}
      sent={sentByBot(logs)}
      validation={validation}
      onLookUp={p.lookUpBotName}
      onAdd={async (token, name) => void check(await p.addBot(token, name))}
      onCheck={(id) => void check(id)}
      onDelete={p.deleteBot}
    />
  )
}

export function DestinationsView({
  destinations,
  hasBot,
  validation,
  onLookUp,
  onAdd,
  onCheck,
  onTest,
  onDelete,
}: {
  destinations: ChatDestination[]
  /** Checking and testing ask Telegram through a saved bot. */
  hasBot: boolean
  validation: Record<string, DestValidation>
  onLookUp: LookUp
  onAdd: (chatId: string, name: string) => Promise<unknown>
  onCheck: (dest: ChatDestination) => void
  onTest: (dest: ChatDestination) => void
  onDelete: (id: string) => Promise<unknown>
}) {
  return (
    <div className="space-y-2">
      <AddForm
        pill="Add destination"
        heading="A chat or channel your bot can post to; the name is looked up"
        idLabel="Chat id"
        idPlaceholder="@channel or -100…"
        nameLabel="Destination name"
        saveLabel="Save destination"
        onLookUp={onLookUp}
        onAdd={onAdd}
      />
      <ListTable
        columns={[
          { label: "Destination" },
          { label: "Chat" },
          { label: "Status" },
          { label: "" },
        ]}
        isEmpty={!destinations.length}
        empty="No destinations yet."
      >
        {destinations.map((d) => (
          <tr key={d.id} className={rowClass}>
            <td className={`${cellClass} font-semibold`}>{d.name}</td>
            <td
              className={`${cellClass} font-mono text-[11px] text-app-ink/60`}
            >
              {d.chatId}
            </td>
            <td className={cellClass}>
              <CheckStatus
                validation={validation[d.id]}
                info={validation[d.id]?.info}
              />
            </td>
            <td className={`${cellClass} whitespace-nowrap text-right`}>
              <span className="inline-flex items-center gap-1">
                <RowAction
                  label={`Check ${d.name}`}
                  disabled={!hasBot || validation[d.id]?.loading}
                  onClick={() => onCheck(d)}
                >
                  Check
                </RowAction>
                {hasBot && (
                  <RowAction
                    label={`Send a test message to ${d.name}`}
                    onClick={() => onTest(d)}
                  >
                    Test
                  </RowAction>
                )}
                <ConfirmButton
                  label={`Delete ${d.name}`}
                  title={`Delete ${d.name}?`}
                  confirmLabel="Delete"
                  onConfirm={() => onDelete(d.id)}
                />
              </span>
            </td>
          </tr>
        ))}
      </ListTable>
    </div>
  )
}

export function Destinations() {
  const p = usePublishing()
  const [validation, setValidation] = useState<Record<string, DestValidation>>(
    {},
  )
  const [testing, setTesting] = useState(false)
  const check = async (dest: ChatDestination) => {
    setValidation((v) => ({
      ...v,
      [dest.id]: { isValid: false, loading: true },
    }))
    const result = await p.checkDestination(dest)
    setValidation((v) => ({ ...v, [dest.id]: result }))
  }
  const test = async (dest: ChatDestination) => {
    setTesting(true)
    await p.testDestination(dest)
    setTesting(false)
  }
  return (
    <>
      {testing && (
        <p className="flex items-center gap-1.5 px-1 pb-1 text-[11px] text-app-ink/60">
          <Loader2 size={11} className="animate-spin" /> Sending a test message…
        </p>
      )}
      <DestinationsView
        destinations={p.destinations}
        hasBot={p.bots.length > 0}
        validation={validation}
        onLookUp={p.lookUpChatName}
        onAdd={async (chatId, name) =>
          void check(await p.addDestination(chatId, name))
        }
        onCheck={(d) => void check(d)}
        onTest={(d) => void test(d)}
        onDelete={p.deleteDestination}
      />
    </>
  )
}
