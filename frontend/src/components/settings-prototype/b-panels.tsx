/**
 * PROTOTYPE, throw away. Variant B's bodies for the hand-written panels,
 * drawn only with `b-kit` (which is only existing workspace primitives). Data
 * and writes are the production ones, through the same stores and generated
 * client calls the old panels use, so **every write here is real**.
 *
 * Left out on purpose, to keep the prototype about looks: the bot / chat
 * auto-lookup and Check buttons, the Tor panel (its fields are rows already),
 * proxy blacklisting history beyond the live cooldown.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, LogOut, RotateCw, Trash2 } from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api, type SettingGroupWriteBody } from "@/api"
import {
  quotaLiftQuotaCeiling,
  quotaReadQuotaLimits,
  quotaReadQuotaUsage,
  quotaSetQuotaDefaults,
  quotaSetQuotaLimitsForUser,
  type UserPublic,
  usersCreateUser,
  usersDeleteUserMe,
  usersReadUsers,
  usersUpdatePasswordMe,
  usersUpdateUserMe,
} from "@/client"
import {
  BUDGETS,
  budgetsFrom,
  draftFrom,
  inheritedText,
  overrideDraftFor,
  showLimit,
  withLimit,
} from "@/components/Admin/quota-limits-model"
import { UserActionsMenu } from "@/components/Admin/UserActionsMenu"
import { BotAvatar } from "@/components/BotAvatar"
import { RelativeTime } from "@/components/RelativeTime"
import {
  draftFromGroup,
  isDeletable,
  PERMISSION_TOGGLES,
  SYNC_TOGGLES,
} from "@/components/setting-groups/setting-groups-model"
import { useProxyTesting } from "@/components/settings/network/useProxyTesting"
import { TgButton } from "@/components/ui/tg-button"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { TgInlineChoice } from "@/components/ui/tg-inline-segments"
import { useSettings } from "@/contexts/SettingsContext"
import { queryKeys } from "@/hooks/queryKeys"
import { useAiKeys, useRefreshAiKeys } from "@/hooks/useAiKeys"
import useAuth from "@/hooks/useAuth"
import {
  useBotCredentials,
  useChatDestinations,
  useSetBotCredentials,
  useSetChatDestinations,
} from "@/hooks/useBots"
import { budgetLabel, budgetRow, useMyQuota } from "@/hooks/useMyQuota"
import {
  useInvalidateSettingGroups,
  useSettingGroupsQuery,
} from "@/hooks/useSettingGroups"
import { deleteAiKey, saveAiKey } from "@/lib/aiKeys/store"
import {
  deleteBotCredential,
  deleteChatDestination,
  saveBotCredential,
  saveChatDestination,
} from "@/lib/bots/store"
import { maskProxyUrl } from "@/lib/network/maskProxyUrl"
import { parseProxyList } from "@/lib/syncSettings"
import type { ChannelSettingGroup } from "@/types"
import {
  AddPill,
  BarHeading,
  BarPopover,
  BarToggle,
  cellClass,
  DraftField,
  FormError,
  fieldClass,
  ListTable,
  pillClass,
  rowClass,
  Status,
} from "./b-kit"

const errorOf = (e: unknown) =>
  (e as { body?: { detail?: string } })?.body?.detail ??
  (e instanceof Error ? e.message : "Something went wrong")

/** A trash icon that asks first, in `TgConfirmDialog`. */
function DeleteButton({
  what,
  onDelete,
}: {
  what: string
  onDelete: () => Promise<unknown>
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={`Delete ${what}`}
        title={`Delete ${what}`}
        onClick={() => setAsking(true)}
        className="rounded-md p-1 text-app-ink/40 hover:bg-red-500/10 hover:text-red-500"
      >
        <Trash2 size={13} />
      </button>
      <TgConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={`Delete ${what}?`}
        confirmLabel="Delete"
        variant="destructive"
        loading={busy}
        onConfirm={async () => {
          setBusy(true)
          try {
            await onDelete()
            setAsking(false)
          } catch (e) {
            toast.error(errorOf(e))
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}

/** Two-column label / value grid, the way the Directory side panel reads. */
function Fields({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid max-w-lg grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-xs">
      {children}
    </dl>
  )
}
const Label = ({ children }: { children: React.ReactNode }) => (
  <dt className="text-[11px] text-app-ink/60">{children}</dt>
)

// --- Account ------------------------------------------------------------------

function SignIn() {
  const { user, logout } = useAuth()
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="text-app-ink/60">
        Signed in as{" "}
        <span className="font-semibold text-app-ink">{user?.email}</span>
      </span>
      <TgButton size="sm" variant="secondary" onClick={logout}>
        <LogOut size={12} /> Sign out
      </TgButton>
    </div>
  )
}

function Profile() {
  const { user } = useAuth()
  const client = useQueryClient()
  const save = async (field: "full_name" | "email", value: string) => {
    try {
      await usersUpdateUserMe({ body: { [field]: value } })
      await client.invalidateQueries({ queryKey: ["currentUser"] })
      toast.success("Saved")
    } catch (e) {
      toast.error(errorOf(e))
    }
  }
  return (
    <Fields>
      <Label>Full name</Label>
      <dd>
        <DraftField
          label="Full name"
          value={user?.full_name ?? ""}
          placeholder="Not set"
          onCommit={(v) => void save("full_name", v)}
        />
      </dd>
      <Label>Email</Label>
      <dd>
        <DraftField
          label="Email"
          type="email"
          value={user?.email ?? ""}
          invalid={(v) => !/^\S+@\S+\.\S+$/.test(v)}
          onCommit={(v) => void save("email", v)}
        />
      </dd>
    </Fields>
  )
}

function Password() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const change = useMutation({
    mutationFn: () =>
      usersUpdatePasswordMe({
        body: { current_password: current, new_password: next },
      }),
    onSuccess: () => {
      toast.success("Password changed")
      setCurrent("")
      setNext("")
      setConfirm("")
      setOpen(false)
    },
    onError: (e) => setError(errorOf(e)),
  })
  const submit = () => {
    if (next.length < 8) return setError("At least 8 characters")
    if (next !== confirm) return setError("The two new passwords differ")
    setError("")
    change.mutate()
  }
  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <input
      type="password"
      aria-label={label}
      placeholder={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && submit()}
      className={`${fieldClass} w-full`}
    />
  )
  return (
    <BarPopover
      width="w-72"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={pillClass(false)}>
          <KeyRound size={12} /> Change password
        </button>
      }
    >
      <BarHeading>Change password</BarHeading>
      <div className="space-y-2 px-1 pb-1">
        {field("Current password", current, setCurrent)}
        {field("New password", next, setNext)}
        {field("New password again", confirm, setConfirm)}
        <FormError>{error}</FormError>
        <TgButton size="sm" loading={change.isPending} onClick={submit}>
          Change
        </TgButton>
      </div>
    </BarPopover>
  )
}

const STATUS_TONE = { normal: "ok", degraded: "warn", blocked: "bad" } as const

function Usage() {
  const { data, isPending } = useMyQuota()
  const budgets = data?.budgets ?? []
  return (
    <ListTable
      columns={[
        { label: "Budget" },
        { label: "Used today", className: "text-right" },
        { label: "Allowance", className: "text-right" },
        { label: "Ceiling", className: "text-right" },
        { label: "Status" },
      ]}
      isEmpty={!budgets.length}
      empty={isPending ? "Loading…" : "No usage yet"}
    >
      {budgets.map((b) => {
        const row = budgetRow(b)
        return (
          <tr key={b.budget} className={rowClass}>
            <td className={`${cellClass} font-semibold`}>{row.label}</td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {row.spent.toLocaleString("en-US")}
            </td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {row.allowance}
            </td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {row.ceiling}
            </td>
            <td className={cellClass}>
              <Status
                tone={
                  STATUS_TONE[b.status as keyof typeof STATUS_TONE] ?? "off"
                }
              >
                {row.status}
              </Status>
            </td>
          </tr>
        )
      })}
    </ListTable>
  )
}

function DeleteAccount() {
  const { logout } = useAuth()
  const [asking, setAsking] = useState(false)
  const remove = useMutation({
    mutationFn: () => usersDeleteUserMe(),
    onSuccess: () => logout(),
    onError: (e) => toast.error(errorOf(e)),
  })
  return (
    <>
      <TgButton size="sm" variant="dangerSoft" onClick={() => setAsking(true)}>
        <Trash2 size={12} /> Delete my account
      </TgButton>
      <TgConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Delete your account?"
        description="Your follows, summaries, chats, keys and bots go with it. This cannot be undone."
        confirmLabel="Delete account"
        variant="destructive"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}

// --- AI keys ------------------------------------------------------------------

function AiKeys() {
  const keys = useAiKeys()
  const refresh = useRefreshAiKeys()
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<"gemini" | "openai_compatible">(
    "gemini",
  )
  const [baseUrl, setBaseUrl] = useState("")
  const [secret, setSecret] = useState("")
  const [label, setLabel] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const add = async () => {
    if (!secret.trim()) return setError("Paste a provider API key")
    if (provider === "openai_compatible" && !baseUrl.trim())
      return setError("An OpenAI-compatible key needs a base URL")
    setSaving(true)
    setError("")
    try {
      const saved = await saveAiKey({
        id: crypto.randomUUID(),
        label: label.trim() || "My key",
        key: secret.trim(),
        provider,
        baseUrl: baseUrl.trim() || null,
      })
      await refresh()
      setSecret("")
      setLabel("")
      setBaseUrl("")
      if (saved.validated) setOpen(false)
      else setError("Saved, but the provider did not confirm it just now")
    } catch (e) {
      setError(errorOf(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="space-y-2">
      <AddPill
        label="Add key"
        heading="A provider key, used for your Summaries, Chats and Tags"
        open={open}
        onOpenChange={setOpen}
      >
        <TgInlineChoice<"gemini" | "openai_compatible">
          aria-label="Provider"
          value={provider}
          onChange={setProvider}
          options={[
            { value: "gemini", label: "Google Gemini" },
            { value: "openai_compatible", label: "OpenAI-compatible" },
          ]}
        />
        {provider === "openai_compatible" && (
          <input
            aria-label="Base URL"
            placeholder="Base URL, e.g. https://openrouter.ai/api/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className={`${fieldClass} w-full`}
          />
        )}
        <input
          type="password"
          aria-label="API key"
          placeholder="API key"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className={`${fieldClass} w-full`}
        />
        <input
          aria-label="Label"
          placeholder="Label, e.g. Work key"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className={`${fieldClass} w-full`}
        />
        <FormError>{error}</FormError>
        <TgButton size="sm" loading={saving} onClick={() => void add()}>
          Save key
        </TgButton>
      </AddPill>
      <ListTable
        columns={[
          { label: "Key" },
          { label: "Provider" },
          { label: "Status" },
          { label: "" },
        ]}
        isEmpty={!keys.length}
        empty="No keys yet. Summaries need one."
      >
        {keys.map((k) => (
          <tr key={k.id} className={rowClass}>
            <td className={`${cellClass} font-semibold`}>{k.label}</td>
            <td
              className={`${cellClass} font-mono text-[11px] text-app-ink/60`}
            >
              {k.baseUrl ?? k.provider}
            </td>
            <td className={cellClass}>
              {k.lastValidated ? (
                <Status tone="ok">
                  Verified <RelativeTime timestamp={k.lastValidated} />
                </Status>
              ) : (
                <Status tone="warn">Not verified, still used</Status>
              )}
            </td>
            <td className={`${cellClass} text-right`}>
              <DeleteButton
                what={k.label}
                onDelete={async () => {
                  await deleteAiKey(k.id)
                  await refresh()
                }}
              />
            </td>
          </tr>
        ))}
      </ListTable>
    </div>
  )
}

// --- Publishing ---------------------------------------------------------------

function Bots() {
  const bots = useBotCredentials()
  const setBots = useSetBotCredentials()
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState("")
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const add = async () => {
    if (!token.trim()) return
    setSaving(true)
    try {
      const bot = {
        id: Date.now().toString(),
        name: name.trim() || "Unnamed bot",
        token: token.trim(),
      }
      await saveBotCredential(bot)
      setBots((prev) => [...prev, { ...bot, token: undefined, hasToken: true }])
      setToken("")
      setName("")
      setOpen(false)
    } catch (e) {
      toast.error(errorOf(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="space-y-2">
      <AddPill
        label="Add bot"
        heading="A bot token from @BotFather"
        open={open}
        onOpenChange={setOpen}
      >
        <input
          type="password"
          aria-label="Bot token"
          placeholder="123456:ABC-…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className={`${fieldClass} w-full font-mono`}
        />
        <input
          aria-label="Name"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${fieldClass} w-full`}
        />
        <TgButton
          size="sm"
          loading={saving}
          disabled={!token.trim()}
          onClick={() => void add()}
        >
          Add bot
        </TgButton>
      </AddPill>
      <ListTable
        columns={[{ label: "Bot" }, { label: "Status" }, { label: "" }]}
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
              {b.lastValidated ? (
                <Status tone="ok">
                  Checked <RelativeTime timestamp={b.lastValidated} />
                </Status>
              ) : (
                <Status tone="off">Not checked</Status>
              )}
            </td>
            <td className={`${cellClass} text-right`}>
              <DeleteButton
                what={b.name}
                onDelete={async () => {
                  await deleteBotCredential(b.id)
                  setBots((prev) => prev.filter((x) => x.id !== b.id))
                }}
              />
            </td>
          </tr>
        ))}
      </ListTable>
    </div>
  )
}

function Destinations() {
  const destinations = useChatDestinations()
  const setDestinations = useSetChatDestinations()
  const [open, setOpen] = useState(false)
  const [chatId, setChatId] = useState("")
  const [name, setName] = useState("")
  const add = async () => {
    if (!chatId.trim()) return
    const dest = {
      id: Date.now().toString(),
      name: name.trim() || chatId.trim(),
      chatId: chatId.trim(),
    }
    try {
      await saveChatDestination(dest)
      setDestinations((prev) => [...prev, dest])
      setChatId("")
      setName("")
      setOpen(false)
    } catch (e) {
      toast.error(errorOf(e))
    }
  }
  return (
    <div className="space-y-2">
      <AddPill
        label="Add destination"
        heading="A chat or channel your bot can post to"
        open={open}
        onOpenChange={setOpen}
      >
        <input
          aria-label="Chat id"
          placeholder="@channel or -100…"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          className={`${fieldClass} w-full font-mono`}
        />
        <input
          aria-label="Name"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${fieldClass} w-full`}
        />
        <TgButton
          size="sm"
          disabled={!chatId.trim()}
          onClick={() => void add()}
        >
          Add destination
        </TgButton>
      </AddPill>
      <ListTable
        columns={[{ label: "Destination" }, { label: "Chat" }, { label: "" }]}
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
            <td className={`${cellClass} text-right`}>
              <DeleteButton
                what={d.name}
                onDelete={async () => {
                  await deleteChatDestination(d.id)
                  setDestinations((prev) => prev.filter((x) => x.id !== d.id))
                }}
              />
            </td>
          </tr>
        ))}
      </ListTable>
    </div>
  )
}

// --- Network ------------------------------------------------------------------

function Proxies() {
  const {
    proxyEnabled,
    setProxyEnabled,
    defaultProxyUrls,
    setDefaultProxyUrls,
    proxyDefaultConcurrency,
    setProxyDefaultConcurrency,
    proxyConcurrencyOverrides,
    setProxyConcurrencyOverrides,
  } = useSettings()
  const { proxyTestResults, isTestingAll, handleTestAllProxies } =
    useProxyTesting()
  const [reveal, setReveal] = useState(false)
  const [paste, setPaste] = useState("")
  const [open, setOpen] = useState(false)
  const { data: health } = useQuery({
    queryKey: ["proto-proxy-health"],
    queryFn: () => api.proxyHealth(),
    refetchInterval: 10_000,
  })
  const cooling = new Map(
    (health?.badProxies ?? []).map((b) => [b.url, b.cooldownRemaining]),
  )
  const proxies = parseProxyList(defaultProxyUrls)
  const show = (url: string) => (reveal ? url : maskProxyUrl(url))
  const remove = (url: string) =>
    setDefaultProxyUrls(proxies.filter((p) => p !== url).join("\n"))
  const add = () => {
    const merged = [...new Set([...proxies, ...parseProxyList(paste)])]
    setDefaultProxyUrls(merged.join("\n"))
    setPaste("")
    setOpen(false)
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <BarToggle
          on={proxyEnabled}
          onClick={() => setProxyEnabled(!proxyEnabled)}
          label="Use proxies"
          title="Rotate syncs through the proxies below"
        />
        <AddPill
          label="Add proxies"
          heading="One proxy URL per line"
          open={open}
          onOpenChange={setOpen}
          width="w-96"
        >
          <textarea
            aria-label="Proxy URLs"
            rows={4}
            value={paste}
            placeholder="socks5h://user:pass@host:port"
            onChange={(e) => setPaste(e.target.value)}
            className="w-full resize-y rounded-lg border border-app-ink/15 bg-app-muted p-2 font-mono text-[11px] outline-none focus:border-app-ink/40"
          />
          <TgButton size="sm" disabled={!paste.trim()} onClick={add}>
            Add {parseProxyList(paste).length}
          </TgButton>
        </AddPill>
        <button
          type="button"
          className={pillClass(false)}
          disabled={!proxies.length || isTestingAll}
          onClick={() => void handleTestAllProxies(defaultProxyUrls)}
        >
          <RotateCw size={12} className={isTestingAll ? "animate-spin" : ""} />
          Test all
        </button>
        <BarToggle
          on={reveal}
          onClick={() => setReveal(!reveal)}
          label="Show credentials"
          title="Proxy credentials are masked until you reveal them"
        />
        <span className="ml-auto flex items-center gap-2 text-[11px] text-app-ink/60">
          Slots per proxy
          <DraftField
            numeric
            label="Slots per proxy"
            value={String(proxyDefaultConcurrency)}
            invalid={(v) => !(Number(v) >= 1)}
            onCommit={(v) => setProxyDefaultConcurrency(Number(v))}
          />
        </span>
      </div>
      <ListTable
        columns={[
          { label: "Proxy" },
          { label: "Slots", className: "text-right" },
          { label: "Test" },
          { label: "Health" },
          { label: "" },
        ]}
        isEmpty={!proxies.length}
        empty="No proxies. Syncs go out directly."
      >
        {proxies.map((url) => {
          const test = proxyTestResults[url]
          const cooldown = cooling.get(url)
          return (
            <tr key={url} className={rowClass}>
              <td
                className={`${cellClass} max-w-72 truncate font-mono text-[11px]`}
              >
                {show(url)}
              </td>
              <td className={`${cellClass} text-right`}>
                <DraftField
                  numeric
                  className="w-16"
                  label={`Slots for ${show(url)}`}
                  value={String(proxyConcurrencyOverrides[url] ?? "")}
                  placeholder={String(proxyDefaultConcurrency)}
                  invalid={(v) => v !== "" && !(Number(v) >= 1)}
                  onCommit={(v) => {
                    const next = { ...proxyConcurrencyOverrides }
                    if (v === "") delete next[url]
                    else next[url] = Number(v)
                    setProxyConcurrencyOverrides(next)
                  }}
                />
              </td>
              <td className={cellClass}>
                {!test ? (
                  <span className="text-app-ink/40">—</span>
                ) : test.testing ? (
                  <Status tone="off">Testing…</Status>
                ) : test.success ? (
                  <Status tone="ok">
                    {test.latency} ms · {test.ip}
                  </Status>
                ) : (
                  <span title={test.error}>
                    <Status tone="bad">Failed</Status>
                  </span>
                )}
              </td>
              <td className={cellClass}>
                {cooldown ? (
                  <Status tone="warn">
                    Cooling down {Math.ceil(cooldown)}s
                  </Status>
                ) : (
                  <Status tone="ok">Healthy</Status>
                )}
              </td>
              <td className={`${cellClass} text-right`}>
                <DeleteButton
                  what={`proxy ${maskProxyUrl(url)}`}
                  onDelete={async () => remove(url)}
                />
              </td>
            </tr>
          )
        })}
      </ListTable>
    </div>
  )
}

// --- Setting groups -----------------------------------------------------------

function GroupEditor({
  group,
  onDone,
}: {
  group: ChannelSettingGroup
  onDone: () => void
}) {
  const invalidate = useInvalidateSettingGroups()
  const [draft, setDraft] = useState<SettingGroupWriteBody>(
    draftFromGroup(group),
  )
  useEffect(() => setDraft(draftFromGroup(group)), [group])
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await api.updateSettingGroup(group.id, draft)
      await invalidate()
      toast.success(`Saved "${draft.name}"`)
      onDone()
    } catch (e) {
      toast.error(errorOf(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3 bg-app-ink/[0.03] px-3 py-3">
      <div className="flex flex-wrap gap-1.5">
        {[...SYNC_TOGGLES, ...PERMISSION_TOGGLES].map(([key, label]) => (
          <BarToggle
            key={key}
            on={Boolean(draft[key])}
            label={label}
            title={label}
            onClick={() => setDraft({ ...draft, [key]: !draft[key] })}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-app-ink/60">
        <span className="flex items-center gap-2">
          Name
          <input
            aria-label="Group name"
            value={draft.name ?? ""}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className={`${fieldClass} w-44`}
          />
        </span>
        <span className="flex items-center gap-2">
          Sync every
          <input
            aria-label="Sync interval minutes"
            inputMode="numeric"
            value={draft.autoSyncIntervalMinutes ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                autoSyncIntervalMinutes: Number(e.target.value) || 0,
              })
            }
            className={`${fieldClass} w-20 text-right tabular-nums`}
          />
          min
        </span>
        <span className="flex items-center gap-2">
          Dynamic sync after
          <input
            aria-label="Expected posts"
            inputMode="numeric"
            value={draft.dynamicSyncExpectedPosts ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                dynamicSyncExpectedPosts: Number(e.target.value) || 0,
              })
            }
            className={`${fieldClass} w-20 text-right tabular-nums`}
          />
          posts
        </span>
      </div>
      <div className="flex items-center gap-2">
        <TgButton size="sm" loading={busy} onClick={() => void save()}>
          Save
        </TgButton>
        <TgButton size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </TgButton>
        {isDeletable(group) && (
          <span className="ml-auto">
            <DeleteButton
              what={`group "${group.name}"`}
              onDelete={async () => {
                await api.deleteSettingGroup(group.id)
                await invalidate()
              }}
            />
          </span>
        )}
      </div>
    </div>
  )
}

function SettingGroups() {
  const { data: groups = [], isLoading } = useSettingGroupsQuery()
  const invalidate = useInvalidateSettingGroups()
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const create = async () => {
    try {
      const created = await api.createSettingGroup({ name: name.trim() })
      await invalidate()
      setName("")
      setAdding(false)
      setOpenId(created.id)
    } catch (e) {
      toast.error(errorOf(e))
    }
  }
  const on = (g: ChannelSettingGroup) =>
    SYNC_TOGGLES.filter(([key]) => g[key]).map(([, label]) => label)
  return (
    <div className="space-y-2">
      <AddPill
        label="New group"
        heading="Starts with the default rules; edit it after"
        open={adding}
        onOpenChange={setAdding}
      >
        <input
          aria-label="Group name"
          placeholder="Group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && void create()}
          className={`${fieldClass} w-full`}
        />
        <TgButton
          size="sm"
          disabled={!name.trim()}
          onClick={() => void create()}
        >
          Create
        </TgButton>
      </AddPill>
      <ListTable
        columns={[
          { label: "Group" },
          { label: "Channels", className: "text-right" },
          { label: "Sync every", className: "text-right" },
          { label: "On" },
        ]}
        isEmpty={!groups.length}
        empty={isLoading ? "Loading…" : "No groups"}
      >
        {groups.map((g) => [
          <tr
            key={g.id}
            onClick={() => setOpenId(openId === g.id ? null : g.id)}
            className={`${rowClass} cursor-pointer ${openId === g.id ? "bg-blue-500/5" : ""}`}
          >
            <td className={`${cellClass} font-semibold`}>
              {g.name}
              {g.isDefault && (
                <span className="ml-2 rounded-full bg-app-ink/10 px-1.5 text-[10px] font-normal">
                  default
                </span>
              )}
            </td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {(g.channelCount ?? 0).toLocaleString("en-US")}
            </td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {g.autoSyncIntervalMinutes} min
            </td>
            <td className={`${cellClass} text-app-ink/60`}>
              {on(g).join(" · ") || "—"}
            </td>
          </tr>,
          openId === g.id && (
            <tr key={`${g.id}-edit`} className="border-t border-app-ink/5">
              <td colSpan={4} className="p-0">
                <GroupEditor group={g} onDone={() => setOpenId(null)} />
              </td>
            </tr>
          ),
        ])}
      </ListTable>
    </div>
  )
}

// --- Admin --------------------------------------------------------------------

function Users() {
  const { user: me } = useAuth()
  const client = useQueryClient()
  const { data, isPending } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersReadUsers({ query: { skip: 0, limit: 100 } }),
  })
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [admin, setAdmin] = useState(false)
  const [error, setError] = useState("")
  const create = useMutation({
    mutationFn: () =>
      usersCreateUser({
        body: {
          email,
          full_name: name || null,
          password,
          is_superuser: admin,
          is_active: true,
          is_approved: true,
        },
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["users"] })
      setEmail("")
      setName("")
      setPassword("")
      setAdmin(false)
      setOpen(false)
    },
    onError: (e) => setError(errorOf(e)),
  })
  const users = data?.data ?? []
  return (
    <div className="space-y-2">
      <AddPill
        label="Add user"
        heading="An approved account, signed in with this password"
        open={open}
        onOpenChange={setOpen}
      >
        <input
          type="email"
          aria-label="Email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${fieldClass} w-full`}
        />
        <input
          aria-label="Full name"
          placeholder="Full name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${fieldClass} w-full`}
        />
        <input
          type="password"
          aria-label="Password"
          placeholder="Password, 8 or more characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={`${fieldClass} w-full`}
        />
        <BarToggle
          on={admin}
          onClick={() => setAdmin(!admin)}
          label="Admin"
          title="Holds every permission"
        />
        <FormError>{error}</FormError>
        <TgButton
          size="sm"
          loading={create.isPending}
          disabled={!email || password.length < 8}
          onClick={() => create.mutate()}
        >
          Add user
        </TgButton>
      </AddPill>
      <ListTable
        columns={[
          { label: "Account" },
          { label: "Role" },
          { label: "Status" },
          { label: "Joined" },
          { label: "" },
        ]}
        isEmpty={!users.length}
        empty={isPending ? "Loading…" : "No users"}
      >
        {users.map((u: UserPublic) => (
          <tr key={u.id} className={rowClass}>
            <td className={cellClass}>
              <div className="font-semibold">
                {u.email}
                {u.id === me?.id && (
                  <span className="ml-2 rounded-full bg-app-ink/10 px-1.5 text-[10px] font-normal">
                    you
                  </span>
                )}
              </div>
              {u.full_name && (
                <div className="text-[11px] text-app-ink/50">{u.full_name}</div>
              )}
            </td>
            <td className={cellClass}>{u.is_superuser ? "Admin" : "Member"}</td>
            <td className={cellClass}>
              {!u.is_active ? (
                <Status tone="off">Switched off</Status>
              ) : u.is_approved === false ? (
                <Status tone="warn">Waiting for approval</Status>
              ) : (
                <Status tone="ok">Active</Status>
              )}
            </td>
            <td className={`${cellClass} text-app-ink/60`}>
              {u.created_at ? (
                <RelativeTime timestamp={new Date(u.created_at).getTime()} />
              ) : (
                "—"
              )}
            </td>
            <td className={`${cellClass} text-right`}>
              <UserActionsMenu user={u} />
            </td>
          </tr>
        ))}
      </ListTable>
    </div>
  )
}

function useQuotaInvalidate() {
  const client = useQueryClient()
  return () => {
    client.invalidateQueries({ queryKey: queryKeys.quotaLimits() })
    client.invalidateQueries({ queryKey: queryKeys.myQuota() })
    client.invalidateQueries({ queryKey: ["quotaUsage"] })
  }
}

function QuotaLimits() {
  const invalidate = useQuotaInvalidate()
  const { data } = useQuery({
    queryKey: queryKeys.quotaLimits(),
    queryFn: () => quotaReadQuotaLimits(),
  })
  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersReadUsers({ query: { skip: 0, limit: 100 } }),
  })
  const stored = draftFrom(data?.storedDefaults ?? [])
  const effective = draftFrom(data?.defaults ?? [])
  const saveDefault = async (
    budget: string,
    field: "allowance" | "ceiling",
    v: string,
  ) => {
    try {
      await quotaSetQuotaDefaults({
        body: { budgets: budgetsFrom(withLimit(stored, budget, field, v)) },
      })
      invalidate()
    } catch (e) {
      toast.error(errorOf(e))
    }
  }
  const [open, setOpen] = useState(false)
  const [userId, setUserId] = useState("")
  const [budget, setBudget] = useState<string>(BUDGETS[0])
  const [allowance, setAllowance] = useState("")
  const [ceiling, setCeiling] = useState("")
  const saveOverride = async () => {
    const draft = withLimit(
      withLimit(
        overrideDraftFor(data?.overrides, userId),
        budget,
        "allowance",
        allowance,
      ),
      budget,
      "ceiling",
      ceiling,
    )
    try {
      await quotaSetQuotaLimitsForUser({
        path: { user_id: userId },
        body: { budgets: budgetsFrom(draft) },
      })
      invalidate()
      setOpen(false)
    } catch (e) {
      toast.error(errorOf(e))
    }
  }
  const overrides = data?.overrides ?? []
  return (
    <div className="space-y-4">
      <ListTable
        columns={[
          { label: "Deployment default" },
          { label: "Allowance", className: "text-right" },
          { label: "Ceiling", className: "text-right" },
        ]}
        isEmpty={false}
        empty=""
      >
        {BUDGETS.map((b) => (
          <tr key={b} className={rowClass}>
            <td className={`${cellClass} font-semibold`}>{budgetLabel(b)}</td>
            {(["allowance", "ceiling"] as const).map((field) => (
              <td key={field} className={`${cellClass} text-right`}>
                <DraftField
                  numeric
                  label={`${budgetLabel(b)} ${field}`}
                  value={stored[b]?.[field] ?? ""}
                  placeholder={inheritedText(
                    data?.defaults?.find((d) => d.budget === b)?.[field],
                  )}
                  invalid={(v) =>
                    v.trim() !== "" && !Number.isFinite(Number(v))
                  }
                  onCommit={(v) => void saveDefault(b, field, v)}
                />
              </td>
            ))}
          </tr>
        ))}
      </ListTable>
      <p className="px-1 text-[11px] text-app-ink/50">
        Blank inherits `.env` (
        {BUDGETS.map(
          (b) => `${budgetLabel(b)} ${effective[b]?.allowance || "∞"}`,
        ).join(", ")}
        ). 0 always runs best-effort; a negative number is unlimited.
      </p>
      <div className="space-y-2">
        <AddPill
          label="Override an account"
          heading="Limits for one account, over the defaults"
          open={open}
          onOpenChange={setOpen}
        >
          <select
            aria-label="Account"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className={`${fieldClass} w-full`}
          >
            <option value="">Pick an account</option>
            {(users?.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
          <TgInlineChoice
            aria-label="Budget"
            value={budget}
            onChange={setBudget}
            options={BUDGETS.map((b) => ({ value: b, label: budgetLabel(b) }))}
          />
          <div className="flex gap-2">
            <input
              aria-label="Allowance"
              placeholder="Allowance"
              inputMode="numeric"
              value={allowance}
              onChange={(e) => setAllowance(e.target.value)}
              className={`${fieldClass} w-full`}
            />
            <input
              aria-label="Ceiling"
              placeholder="Ceiling"
              inputMode="numeric"
              value={ceiling}
              onChange={(e) => setCeiling(e.target.value)}
              className={`${fieldClass} w-full`}
            />
          </div>
          <TgButton
            size="sm"
            disabled={!userId}
            onClick={() => void saveOverride()}
          >
            Save override
          </TgButton>
        </AddPill>
        <ListTable
          columns={[
            { label: "Account" },
            { label: "Budget" },
            { label: "Allowance", className: "text-right" },
            { label: "Ceiling", className: "text-right" },
            { label: "" },
          ]}
          isEmpty={!overrides.length}
          empty="No account has its own limits"
        >
          {overrides.map((o) => (
            <tr key={`${o.userId}-${o.budget}`} className={rowClass}>
              <td className={`${cellClass} font-semibold`}>
                {o.email ?? o.userId}
              </td>
              <td className={cellClass}>{budgetLabel(o.budget)}</td>
              <td className={`${cellClass} text-right tabular-nums`}>
                {showLimit(o.allowance) || "inherit"}
              </td>
              <td className={`${cellClass} text-right tabular-nums`}>
                {showLimit(o.ceiling) || "inherit"}
              </td>
              <td className={`${cellClass} text-right`}>
                <DeleteButton
                  what={`${budgetLabel(o.budget)} override for ${o.email ?? "this account"}`}
                  onDelete={async () => {
                    await quotaSetQuotaLimitsForUser({
                      path: { user_id: o.userId },
                      body: {
                        budgets: [
                          { budget: o.budget, allowance: null, ceiling: null },
                        ],
                      },
                    })
                    invalidate()
                  }}
                />
              </td>
            </tr>
          ))}
        </ListTable>
      </div>
    </div>
  )
}

function QuotaUsage() {
  const invalidate = useQuotaInvalidate()
  const today = new Date().toISOString().slice(0, 10)
  const [day, setDay] = useState(today)
  const { data, isPending } = useQuery({
    queryKey: queryKeys.quotaUsage(day),
    queryFn: () => quotaReadQuotaUsage({ query: day === today ? {} : { day } }),
  })
  const lift = useMutation({
    mutationFn: (userId: string) =>
      quotaLiftQuotaCeiling({
        path: { user_id: userId },
        body: { budgets: [], lifted: true },
      }),
    onSuccess: invalidate,
    onError: (e) => toast.error(errorOf(e)),
  })
  const entries = [...(data?.entries ?? [])].sort(
    (a, b) => (b.total ?? 0) - (a.total ?? 0),
  )
  const num = (n?: number) => (n ?? 0).toLocaleString("en-US")
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] text-app-ink/60">
        Day (UTC)
        <input
          type="date"
          aria-label="Day"
          value={day}
          max={today}
          onChange={(e) => setDay(e.target.value || today)}
          className={`${fieldClass} w-36`}
        />
      </div>
      <ListTable
        columns={[
          { label: "Account" },
          { label: "Scheduled", className: "text-right" },
          { label: "Bulk", className: "text-right" },
          { label: "Single", className: "text-right" },
          { label: "Total", className: "text-right" },
          { label: "" },
        ]}
        isEmpty={!entries.length}
        empty={isPending ? "Loading…" : "Nothing spent that day"}
      >
        {entries.map((e) => (
          <tr key={e.userId} className={rowClass}>
            <td className={`${cellClass} font-semibold`}>{e.email}</td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {num(e.autoSync)}
            </td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {num(e.manualBulk)}
            </td>
            <td className={`${cellClass} text-right tabular-nums`}>
              {num(e.manualSingle)}
            </td>
            <td
              className={`${cellClass} text-right font-semibold tabular-nums`}
            >
              {num(e.total)}
            </td>
            <td className={`${cellClass} text-right`}>
              {day === today &&
                (e.autoSyncLifted ||
                e.manualBulkLifted ||
                e.manualSingleLifted ? (
                  <Status tone="ok">Lifted today</Status>
                ) : (
                  <button
                    type="button"
                    className={pillClass(false)}
                    onClick={() => lift.mutate(e.userId)}
                  >
                    Lift today
                  </button>
                ))}
            </td>
          </tr>
        ))}
      </ListTable>
    </div>
  )
}

/** Panel id → B's body. A panel missing here is hidden in B. */
export const B_PANEL_BODIES: Record<string, () => React.ReactNode> = {
  "account.yours.signIn": () => <SignIn />,
  "account.yours.profile": () => <Profile />,
  "account.yours.password": () => <Password />,
  "account.yours.usage": () => <Usage />,
  "account.yours.delete": () => <DeleteAccount />,
  "ai.yours.keys": () => <AiKeys />,
  "sync.yours.settingGroups": () => <SettingGroups />,
  "publishing.yours.bots": () => <Bots />,
  "publishing.yours.destinations": () => <Destinations />,
  "network.deployment.proxies": () => <Proxies />,
  "admin.users.list": () => <Users />,
  "admin.quota.limits": () => <QuotaLimits />,
  "admin.quota.usage": () => <QuotaUsage />,
}
