import { useEffect, useState } from "react";
import { Database, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { checkNeedsMigration, importIndexedDBToServer } from "@/lib/repository";
import { useData } from "@/contexts/DataContext";
import { Modal } from "./ui/Modal";

const DISMISSED_KEY = "migration_prompt_dismissed";

export function MigrationPrompt() {
  const { loadChannels, loadHistory, loadDBStats } = useData();
  const [show, setShow] = useState(false);
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY)) return;
    checkNeedsMigration()
      .then((needs) => {
        if (needs) setShow(true);
      })
      .catch(console.error);
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setShow(false);
  };

  const handleMigrate = async () => {
    setMigrating(true);
    try {
      const imported = await importIndexedDBToServer();
      const summary = Object.entries(imported)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      toast.success(`Migration complete (${summary || "no records"})`);
      await Promise.all([loadDBStats(), loadChannels(), loadHistory()]);
      localStorage.setItem(DISMISSED_KEY, "1");
      setShow(false);
    } catch (err: unknown) {
      console.error("Migration failed:", err);
      toast.error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMigrating(false);
    }
  };

  if (!show) return null;

  return (
    <Modal
      isOpen={show}
      onClose={handleDismiss}
      title="Migrate Local Data to Server"
    >
      <div className="space-y-4">
        <p className="text-sm text-app-ink/70">
          Your browser has Telegram Summarizer data in IndexedDB, but the PostgreSQL
          backend is empty. Migrate now to make the server the source of truth.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleDismiss}
            disabled={migrating}
            className="px-4 py-2 text-xs font-mono uppercase tracking-widest border border-app-ink/20 hover:border-app-ink/40 rounded-md"
          >
            Later
          </button>
          <button
            onClick={handleMigrate}
            disabled={migrating}
            className="px-4 py-2 text-xs font-mono uppercase tracking-widest bg-app-ink text-app-bg rounded-md flex items-center gap-2 disabled:opacity-50"
          >
            {migrating ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
            Migrate Now
          </button>
        </div>
      </div>
    </Modal>
  );
}
