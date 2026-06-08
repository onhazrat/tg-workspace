import { createFileRoute } from "@tanstack/react-router"

import App from "@/App"
import { TgProviders } from "@/components/TgProviders"

export const Route = createFileRoute("/_tg/summarizer")({
  component: SummarizerPage,
  head: () => ({
    meta: [{ title: "Summarizer - TG Summarizer" }],
  }),
})

function SummarizerPage() {
  return (
    <TgProviders>
      <App />
    </TgProviders>
  )
}
