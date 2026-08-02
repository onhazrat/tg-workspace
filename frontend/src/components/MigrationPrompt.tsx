import { Database } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useData } from "@/contexts/DataContext"
import { useLoadDBStats } from "@/hooks/useDBStats"
import { useInvalidateSummaries } from "@/hooks/useSummaries"
import { checkNeedsMigration, importIndexedDBToServer } from "@/lib/repository"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import { TgButton } from "./ui/tg-button"

const DISMISSED_KEY = "migration_prompt_dismissed"

export function MigrationPrompt() {
  const { loadChannels } = useData()
  const loadHistory = useInvalidateSummaries()
  const loadDBStats = useLoadDBStats()
  const [show, setShow] = useState(false)
  const [migrating, setMigrating] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY)) return
    checkNeedsMigration()
      .then((needs) => {
        if (needs) setShow(true)
      })
      .catch(console.error)
  }, [])

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1")
    setShow(false)
  }

  const handleMigrate = async () => {
    setMigrating(true)
    try {
      const imported = await importIndexedDBToServer()
      const summary = Object.entries(imported)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")
      toast.success(`Migration complete (${summary || "no records"})`)
      await Promise.all([loadDBStats(), loadChannels(), loadHistory()])
      localStorage.setItem(DISMISSED_KEY, "1")
      setShow(false)
    } catch (err: unknown) {
      console.error("Migration failed:", err)
      toast.error(
        `Migration failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setMigrating(false)
    }
  }

  if (!show) return null

  return (
    <Dialog open={show} onOpenChange={(open) => !open && handleDismiss()}>
      <DialogContent className="border-app-ink/20 bg-app-card text-app-ink sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Migrate Local Data to Server</DialogTitle>
          <DialogDescription className="text-app-ink/70">
            Your browser has Telegram Summarizer data in IndexedDB, but the
            PostgreSQL backend is empty. Migrate now to make the server the
            source of truth.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <TgButton
            type="button"
            variant="secondary"
            size="md"
            onClick={handleDismiss}
            disabled={migrating}
          >
            Later
          </TgButton>
          <TgButton
            type="button"
            variant="primary"
            size="md"
            onClick={handleMigrate}
            loading={migrating}
          >
            <Database size={14} />
            Migrate Now
          </TgButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
