import { Eye } from "lucide-react"

import type { UserPublic } from "@/client"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import useCustomToast from "@/hooks/useCustomToast"
import useViewAs from "@/hooks/useViewAs"
import { handleError } from "@/utils"

interface ViewAsUserProps {
  user: UserPublic
}

/**
 * "View as" in the admin row menu (ticket 26).
 *
 * Offered for every account, and refused by the server for the ones that may
 * not be viewed — a peer holding the permission, a disabled account, the
 * caller's own row. Hiding the item for those instead would mean the browser
 * deciding who holds `VIEW_AS`, which is a fact it does not have and would have
 * to be told; `UserPublic` carries no roles, and adding them so a menu could
 * grey out an item would publish the deployment's Owners to every client.
 *
 * The refusal is one message for all three cases, deliberately, so the menu
 * cannot be used to map who holds what.
 */
export default function ViewAsUser({ user }: ViewAsUserProps) {
  const { start } = useViewAs()
  const { showErrorToast } = useCustomToast()

  return (
    <DropdownMenuItem
      onSelect={(event) => {
        // The click starts a navigation away from this page; letting the menu
        // close itself first unmounts the handler mid-flight.
        event.preventDefault()
        start(user.id).catch(handleError.bind(showErrorToast))
      }}
    >
      <Eye className="size-4" />
      View as
    </DropdownMenuItem>
  )
}
