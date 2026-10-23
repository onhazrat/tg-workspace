/**
 * The hand-written parts of the Settings page (SET-02): what is more than one
 * value, embedded in its topic. Each has an id like a Setting's, so search,
 * `?setting=` links and the contents treat it as one.
 *
 * SET-03 redrew every body with the page's own pieces (`kit.tsx`); the old
 * panels are gone. A panel names the Permission that shows it, read from the
 * registry's own answer rather than from a 403.
 */
import type React from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import type { JobStatusEntry } from "@/api/jobs"
import { TgButton } from "@/components/ui/tg-button"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { useData } from "@/contexts/DataContext"
import { APP_VERSION } from "@/lib/app-version"
import { QUOTA_READ_ANY } from "@/lib/permissions"
import {
  DeleteAccount,
  Usage as MyUsage,
  Password,
  Profile,
  SignIn,
} from "./account-panels"
import { AiKeys } from "./ai-keys-panel"
import { Proxies, TorActions } from "./network-panels"
import { Overrides, Usage, Users } from "./operator-panels"
import { Bots, Destinations } from "./publishing-panels"
import { SettingGroups } from "./setting-groups-panel"

export interface Panel {
  id: string
  topic: string
  title: string
  description: string
  keywords: string
  /** The Permission that shows it; none means every Account. */
  permission?: string
  render: () => React.ReactNode
}

function Version() {
  return (
    <p className="font-mono text-xs">
      <span data-testid="app-version">{APP_VERSION}</span>
    </p>
  )
}

/** Clears every followed channel's Posts and syncs them again, after asking. */
export function BulkResync({
  onRun,
}: {
  onRun: () => Promise<{
    channelsReset: number
    postsDeleted: number
    errors: unknown[]
  }>
}) {
  const [asking, setAsking] = useState(false)
  const [running, setRunning] = useState(false)
  const run = async () => {
    setRunning(true)
    try {
      const result = await onRun()
      toast.success(
        `Reset ${result.channelsReset} channel(s); deleted ${result.postsDeleted} post(s).${
          result.errors.length ? ` ${result.errors.length} error(s).` : ""
        }`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk re-sync failed")
    } finally {
      setRunning(false)
      setAsking(false)
    }
  }
  return (
    <>
      <TgButton variant="secondary" size="sm" onClick={() => setAsking(true)}>
        Reset and sync all channels
      </TgButton>
      <TgConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Reset and sync all channels?"
        description="Deletes the stored Posts of every channel you follow and fetches them again, back to the retention window."
        variant="dangerSoft"
        confirmLabel="Reset and sync"
        loading={running}
        onConfirm={run}
      />
    </>
  )
}

function BulkResyncPanel() {
  const { loadChannels } = useData()
  return (
    <BulkResync
      onRun={async () => {
        const result = await api.bulkResetSync({ confirm: true })
        await loadChannels()
        return result
      }}
    />
  )
}

const JOB_NAMES: Record<string, string> = {
  auto_sync: "Auto sync",
  embeddings: "Embeddings",
  auto_summary: "Auto summary",
  retention: "Retention",
  translation_batch: "Translation batch",
}

/** One scheduled job's last run, and a Run now. */
export function JobRunRow({
  name,
  entry,
  running,
  onRun,
}: {
  name: string
  entry: JobStatusEntry | undefined
  running: boolean
  onRun: () => void
}) {
  const failed = entry?.lastStatus === "error"
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0 text-xs">
        <span className="font-semibold">{name}</span>{" "}
        <span className={failed ? "text-red-500" : "text-app-ink/50"}>
          {entry?.lastStatus || "never run"}
          {entry?.lastError ? ` · ${entry.lastError.slice(0, 60)}` : ""}
        </span>
      </div>
      <TgButton
        variant="secondary"
        size="sm"
        loading={running}
        loadingLabel="…"
        onClick={onRun}
      >
        Run now
      </TgButton>
    </div>
  )
}

function JobRuns() {
  const [status, setStatus] = useState<Record<string, JobStatusEntry>>({})
  const [running, setRunning] = useState<string | null>(null)
  const refresh = () =>
    api
      .jobsStatus()
      .then(setStatus)
      .catch(() => {})
  useEffect(() => {
    void refresh()
    const timer = setInterval(refresh, 15_000)
    return () => clearInterval(timer)
  }, [])
  const run = async (jobId: string) => {
    setRunning(jobId)
    try {
      await api.triggerJob(jobId)
      toast.success(`Triggered ${JOB_NAMES[jobId] ?? jobId}`)
      await refresh()
    } catch {
      toast.error(`Failed to trigger ${JOB_NAMES[jobId] ?? jobId}`)
    } finally {
      setRunning(null)
    }
  }
  return (
    <div className="divide-y divide-app-ink/5">
      {Object.entries(JOB_NAMES).map(([jobId, name]) => (
        <JobRunRow
          key={jobId}
          name={name}
          entry={status[jobId]}
          running={running === jobId}
          onRun={() => void run(jobId)}
        />
      ))}
    </div>
  )
}

export const PANELS: Panel[] = [
  {
    id: "account.yours.signIn",
    topic: "account",
    title: "Signed in",
    description: "Who this browser is signed in as.",
    keywords: "sign out logout session",
    render: () => <SignIn />,
  },
  {
    id: "account.yours.profile",
    topic: "account",
    title: "Profile",
    description: "Your name and email. Each saves on Enter.",
    keywords: "name email profile",
    render: () => <Profile />,
  },
  {
    id: "account.yours.password",
    topic: "account",
    title: "Password",
    description: "Change the password you sign in with.",
    keywords: "password change",
    render: () => <Password />,
  },
  {
    id: "account.yours.usage",
    topic: "account",
    title: "Today's usage",
    description:
      "Requests your syncs made to Telegram today, per Budget. Past the allowance syncs slow down; past the ceiling they stop until UTC midnight.",
    keywords: "usage quota budget requests allowance ceiling",
    render: () => <MyUsage />,
  },
  {
    id: "account.yours.delete",
    topic: "account",
    title: "Delete account",
    description: "Delete your Account and everything it owns.",
    keywords: "delete remove account danger",
    render: () => <DeleteAccount />,
  },
  {
    id: "appearance.browser.version",
    topic: "appearance",
    title: "Version",
    description: "The version of the app this browser runs.",
    keywords: "version build about",
    render: () => <Version />,
  },
  {
    id: "sync.yours.settingGroups",
    topic: "sync",
    title: "Setting groups",
    description:
      "Sync rules shared by a set of channels. Open a group to edit it; move channels between groups on the Channels tab.",
    keywords: "group groups channel rules",
    render: () => <SettingGroups />,
  },
  {
    id: "sync.yours.resyncAll",
    topic: "sync",
    title: "Reset and sync all channels",
    description:
      "Deletes the stored Posts of every channel you follow and fetches them again.",
    keywords: "bulk resync reset backfill",
    render: () => <BulkResyncPanel />,
  },
  {
    id: "ai.yours.keys",
    topic: "ai",
    title: "AI keys",
    description:
      "The keys your Summaries, Chats and Tags are paid with. Embeddings and translations use the deployment's key, because every follower shares them.",
    keywords: "api key gemini openai openrouter provider byok",
    render: () => <AiKeys />,
  },
  {
    id: "publishing.yours.bots",
    topic: "publishing",
    title: "Bots",
    description: "Telegram bots that publish your Summaries.",
    keywords: "bot token telegram publish credentials check",
    render: () => <Bots />,
  },
  {
    id: "publishing.yours.destinations",
    topic: "publishing",
    title: "Destinations",
    description:
      "Chats and channels your bots publish to. Check and Test use your first bot.",
    keywords: "destination chat channel publish test message",
    render: () => <Destinations />,
  },
  {
    id: "network.deployment.proxies",
    topic: "network",
    title: "Proxy pool",
    description: "The proxies every sync goes through, their slots and health.",
    keywords: "proxy proxies socks http pool slots test health",
    permission: "data:admin",
    render: () => <Proxies />,
  },
  {
    id: "network.deployment.torActions",
    topic: "network",
    title: "Tor actions",
    description: "Test Tor's exit IP, or ask it for a new circuit.",
    keywords: "tor onion rotate test restart circuit ip",
    permission: "data:admin",
    render: () => <TorActions />,
  },
  {
    id: "jobs.deployment.runs",
    topic: "jobs",
    title: "Job runs",
    description: "When each scheduled job last ran, and running one now.",
    keywords: "scheduler job run trigger status",
    permission: "jobs:manage",
    render: () => <JobRuns />,
  },
  {
    id: "operator.deployment.users",
    topic: "operator",
    title: "Users",
    description:
      "Every Account, its role and approval. Edit, approve, View as, export or delete one from its row.",
    keywords: "users accounts approve role view as export delete add",
    permission: "users:read",
    render: () => <Users />,
  },
  {
    id: "operator.deployment.quotaOverrides",
    topic: "operator",
    title: "Quota overrides",
    description:
      "Accounts with their own allowance or ceiling, over the deployment's.",
    keywords: "quota limits override allowance ceiling budget",
    permission: "quota:manage",
    render: () => <Overrides />,
  },
  {
    id: "operator.deployment.usage",
    topic: "operator",
    title: "Usage",
    description: "Each Account's Requests for one UTC day, and Lift today.",
    keywords: "quota usage requests lift ceiling",
    permission: QUOTA_READ_ANY,
    render: () => <Usage />,
  },
]

export function visiblePanels(permissions: readonly string[]): Panel[] {
  return PANELS.filter(
    (p) => !p.permission || permissions.includes(p.permission),
  )
}

/** Whether a panel matches the search: words only, operators exclude it. */
export function panelMatches(panel: Panel, words: string[]): boolean {
  const hay =
    `${panel.id} ${panel.title} ${panel.description} ${panel.keywords}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}
