import { Download } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import type { UserPublic } from "@/client"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { exportAccountBlob } from "@/lib/data-transfer/database"
import {
  buildTimestampedFilename,
  downloadBlob,
} from "@/lib/data-transfer/download"

interface ExportUserDataProps {
  user: UserPublic
}

/**
 * "Export data" in the admin row menu (ticket 28).
 *
 * The whole account: their follows, all four artifact families, their
 * credentials and their personal settings, plus the Posts of the channels they
 * follow. No table selection, unlike the Settings page's own export — this
 * answers "give me everything about this person", and a partial answer to that
 * is the worse artifact.
 *
 * Offered for every account and gated by the server, the same way
 * `ViewAsUser` is: whether the caller holds `DATA_ADMIN` is not a fact the
 * browser has, and publishing it so a menu could grey an item out would map
 * the deployment's Admins to every client.
 */
export default function ExportUserData({ user }: ExportUserDataProps) {
  const [busy, setBusy] = useState(false)

  return (
    <DropdownMenuItem
      disabled={busy}
      onSelect={(event) => {
        // The download runs past the menu's own close animation; letting it
        // unmount this handler mid-flight cancels the fetch.
        event.preventDefault()
        setBusy(true)
        toast.info(`Exporting ${user.email}…`, { id: "export-user" })
        exportAccountBlob(user.id)
          .then((blob) => {
            downloadBlob(blob, buildTimestampedFilename(`export-${user.email}`))
            toast.success("Export ready", { id: "export-user" })
          })
          .catch((error: unknown) => {
            toast.error(
              `Export failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
              { id: "export-user" },
            )
          })
          .finally(() => setBusy(false))
      }}
    >
      <Download className="size-4" />
      Export data
    </DropdownMenuItem>
  )
}
