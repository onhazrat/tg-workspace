import { EllipsisVertical, Pencil, Trash2 } from "lucide-react"
import { useState } from "react"

import type { UserPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import useAuth from "@/hooks/useAuth"
import DeleteUser from "./DeleteUser"
import EditUser from "./EditUser"
import ExportUserData from "./ExportUserData"
import ViewAsUser from "./ViewAsUser"

interface UserActionsMenuProps {
  user: UserPublic
}

export const UserActionsMenu = ({ user }: UserActionsMenuProps) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { user: currentUser } = useAuth()

  if (user.id === currentUser?.id) {
    return null
  }

  // Dialogs must sit *outside* DropdownMenuContent. Nesting them inside made
  // the dialog unmount when the menu closed (focus moved into the dialog),
  // which detached Save/Delete mid-click and flaked admin e2e under
  // --fail-on-flaky-tests.
  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil />
            Edit User
          </DropdownMenuItem>
          <ViewAsUser user={user} />
          <ExportUserData user={user} />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2 />
            Delete User
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditUser user={user} open={editOpen} onOpenChange={setEditOpen} />
      <DeleteUser id={user.id} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  )
}
