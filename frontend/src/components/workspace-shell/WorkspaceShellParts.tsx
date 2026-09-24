import { AlertCircle, AlertTriangle } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { RelativeTime } from "../RelativeTime"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog"
import { shortcutGroups } from "./workspace-shell-model"

const BANNER_MOTION = {
  initial: { height: 0, opacity: 0, marginBottom: 0 },
  animate: { height: "auto", opacity: 1, marginBottom: 16 },
  exit: { height: 0, opacity: 0, marginBottom: 0 },
}

/** The offline and auto-sync-paused banners above the workspace. */
export function StatusBanners({
  offline,
  autoSyncPausedUntil,
  onResumeAutoSync,
}: {
  offline: boolean
  /** When auto-sync resumes on its own; null or past when it is running. */
  autoSyncPausedUntil: number | null
  onResumeAutoSync: () => void
}) {
  const paused =
    autoSyncPausedUntil !== null && Date.now() < autoSyncPausedUntil
  return (
    <>
      <AnimatePresence>
        {offline && (
          <motion.div
            {...BANNER_MOTION}
            className="bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 px-4 py-3 flex items-center gap-3 text-xs rounded-md overflow-hidden"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              <strong className="uppercase tracking-wider">
                Server offline.
              </strong>{" "}
              Showing cached data. Sync, summary, and publish actions are
              disabled.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {paused && (
          <motion.div
            {...BANNER_MOTION}
            className="bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-3 flex items-center justify-between text-xs rounded-md overflow-hidden"
          >
            <div className="flex items-center gap-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                <strong className="uppercase tracking-wider">
                  Auto-sync paused.
                </strong>{" "}
                Multiple channels failed to update. Auto-sync will resume in{" "}
                <RelativeTime timestamp={autoSyncPausedUntil} />.
              </span>
            </div>
            <button
              type="button"
              onClick={onResumeAutoSync}
              className="px-3 py-1.5 hover:bg-red-500/10 rounded transition-colors font-medium font-mono uppercase tracking-widest text-[10px] whitespace-nowrap"
            >
              Resume Now
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export function RateLimitBanner() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="mb-6 bg-red-500 text-white p-3 flex items-center justify-center gap-3 font-bold uppercase tracking-tighter text-xs animate-pulse"
    >
      <AlertTriangle size={16} />
      Telegram Rate Limit Active - Retrying with exponential backoff...
    </motion.div>
  )
}

export function ShortcutsDialog({
  open,
  onOpenChange,
  commandKey,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  commandKey: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-app-ink/20 bg-app-card p-0 text-app-ink sm:max-w-xl">
        <DialogHeader className="border-b border-app-ink/10 p-4">
          <DialogTitle className="text-lg font-bold tracking-tight uppercase">
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 p-4 text-xs font-mono uppercase tracking-widest">
          {shortcutGroups(commandKey).map((group) => (
            <section key={group.heading} className="space-y-2">
              <h3 className="text-[10px] text-app-ink/50">{group.heading}</h3>
              {group.bindings.map((binding) => (
                <div
                  key={binding.label}
                  className="flex items-center justify-between rounded-md border border-app-ink/10 bg-app-muted/30 px-3 py-2"
                >
                  <span>{binding.label}</span>
                  <code>{binding.keys}</code>
                </div>
              ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Stat({
  label,
  testId,
  children,
}: {
  label: string
  testId?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-[10px] font-mono uppercase tracking-widest text-app-ink/50 mb-0.5">
        {label}
      </span>
      <span
        data-testid={testId}
        className="text-xs font-medium tracking-tighter leading-none font-mono"
      >
        {children}
      </span>
    </div>
  )
}

/** Last sync, active channels and posts in scope, beside the tab bar. */
export function WorkspaceStats({
  lastSync,
  activeChannels,
  postsInScope,
}: {
  /** The stalest selected channel's last sync, or null with none selected. */
  lastSync: number | null
  activeChannels: number
  postsInScope: number
}) {
  return (
    <>
      <Stat label="Last Sync">
        {lastSync === null ? "—" : <RelativeTime timestamp={lastSync} />}
      </Stat>
      <Stat label="Active Channels" testId="header-active-channels">
        {activeChannels}
      </Stat>
      <Stat label="Posts in Scope">{postsInScope.toLocaleString()}</Stat>
    </>
  )
}
