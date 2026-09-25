import { createFileRoute } from "@tanstack/react-router"

import App from "@/App"
import { TgProviders } from "@/components/TgProviders"
import { validateWorkspaceSearch } from "@/lib/workspace-search"

export const Route = createFileRoute("/_tg/workspace")({
  validateSearch: validateWorkspaceSearch,
  component: WorkspacePage,
  head: () => ({
    meta: [{ title: "Workspace - TG Workspace" }],
  }),
})

function WorkspacePage() {
  return (
    <TgProviders>
      <App />
    </TgProviders>
  )
}
