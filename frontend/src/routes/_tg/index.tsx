import { createFileRoute } from "@tanstack/react-router"

import App from "@/App"
// PROTOTYPE
import { CoverageVariantRoot } from "@/components/coverage-prototype/variant"
import { TgProviders } from "@/components/TgProviders"
import { validateWorkspaceSearch } from "@/lib/workspace-search"

export const Route = createFileRoute("/_tg/")({
  validateSearch: validateWorkspaceSearch,
  component: WorkspacePage,
  head: () => ({
    meta: [{ title: "TG Workspace" }],
  }),
})

function WorkspacePage() {
  return (
    <TgProviders>
      <CoverageVariantRoot>
        <App />
      </CoverageVariantRoot>
    </TgProviders>
  )
}
