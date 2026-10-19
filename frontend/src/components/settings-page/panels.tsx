/**
 * The hand-written parts of the Settings page (SET-02): what is more than one
 * value, embedded in its topic. Each has an id like a Setting's, so search,
 * `?setting=` links and the contents treat it as one.
 *
 * The bodies are the production components, unchanged; SET-03 redraws them in
 * the page's style. A panel names the Permission that shows it, read from the
 * registry's own answer rather than from a 403.
 */
import { getRouteApi } from "@tanstack/react-router"
import type React from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { api } from "@/api"
import type { JobStatusEntry } from "@/api/jobs"
import { BotManagement } from "@/components/BotManagement"
import { ConfigurationCatalogView } from "@/components/ConfigurationCatalogView"
import { SettingGroupsPanel } from "@/components/SettingGroupsPanel"
import { AccountSection } from "@/components/settings/account/AccountSection"
import { UsersSection } from "@/components/settings/account/UsersSection"
import { AIKeysPanel } from "@/components/settings/ai/AIKeysPanel"
import { NetworkSection } from "@/components/settings/NetworkSection"
import { TgButton } from "@/components/ui/tg-button"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { useData } from "@/contexts/DataContext"
import { APP_VERSION } from "@/lib/app-version"

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

const workspaceRoute = getRouteApi("/_tg/")

/** The `.env` and runtime inventory, until SET-04 makes them rows. */
function Configuration() {
  const { setting } = workspaceRoute.useSearch()
  return <ConfigurationCatalogView focusId={setting} />
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
    id: "account.yours.profile",
    topic: "account",
    title: "Profile",
    description:
      "Who you are signed in as, your name, email and password, today's usage, and deleting your Account.",
    keywords: "sign out logout name email password usage quota delete",
    render: () => <AccountSection />,
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
    description: "Sync and summary rules shared by a set of channels.",
    keywords: "group groups channel rules",
    render: () => <SettingGroupsPanel />,
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
    description: "The Keys your Summaries, Chats and Tags are paid with.",
    keywords: "api key gemini openai openrouter provider byok",
    render: () => <AIKeysPanel />,
  },
  {
    id: "publishing.yours.bots",
    topic: "publishing",
    title: "Bots",
    description: "Telegram bots that publish your Summaries.",
    keywords: "bot token telegram publish credentials",
    render: () => <BotManagement focus="bot-credentials" />,
  },
  {
    id: "publishing.yours.destinations",
    topic: "publishing",
    title: "Destinations",
    description: "Chats and channels your bots publish to.",
    keywords: "destination chat channel publish",
    render: () => <BotManagement focus="destinations" />,
  },
  {
    id: "network.deployment.proxies",
    topic: "network",
    title: "Proxies",
    description: "The proxy pool every sync goes through.",
    keywords: "proxy proxies socks http pool",
    permission: "data:admin",
    render: () => <NetworkSection focus="proxy" />,
  },
  {
    id: "network.deployment.torPanel",
    topic: "network",
    title: "Tor",
    description: "Test Tor and ask it for a new circuit.",
    keywords: "tor onion rotate test",
    permission: "data:admin",
    render: () => <NetworkSection focus="tor" />,
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
    id: "server.deployment.configuration",
    topic: "server",
    title: "Configuration",
    description:
      "Every .env value the deployment reads and every runtime settings row, as stored.",
    keywords: "configuration env environment catalog",
    permission: "data:admin",
    render: () => <Configuration />,
  },
  {
    id: "operator.deployment.users",
    topic: "operator",
    title: "Users",
    description:
      "Every Account, its role and approval, its quota overrides and today's usage.",
    keywords: "users accounts approve role view as quota limits usage",
    permission: "users:read",
    render: () => <UsersSection />,
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
