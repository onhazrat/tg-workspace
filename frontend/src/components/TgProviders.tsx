import type { ReactNode } from "react"
import { toast } from "sonner"
import { CommandPalette } from "@/components/CommandPalette"
import { CommandPaletteProvider } from "@/components/CommandPaletteProvider"
import { MigrationPrompt } from "@/components/MigrationPrompt"
import { TgToaster } from "@/components/ui/tg-sonner"
import { TooltipProvider } from "@/components/ui/tg-tooltip"
import { AIProvider } from "@/contexts/AIContext"
import { ChatProvider } from "@/contexts/ChatContext"
import { DataProvider } from "@/contexts/DataContext"
import { RAGProvider } from "@/contexts/RAGContext"
import { ScraperProvider } from "@/contexts/ScraperContext"
import { SettingsProvider } from "@/contexts/SettingsContext"
import { TranslationProvider } from "@/contexts/TranslationContext"
import { UIProvider } from "@/contexts/UIContext"
import { useBotCredentialMigration } from "@/hooks/useBotCredentialMigration"
import { migrateEmbeddingsData, migrateSummaryDates } from "@/lib/cache"
import { setWriteFallbackHandler } from "@/lib/repository"

migrateEmbeddingsData().catch(console.error)
migrateSummaryDates().catch(console.error)

setWriteFallbackHandler((resource, error) => {
  const message = error instanceof Error ? error.message : String(error)
  const isAuthError =
    message.includes("Not authenticated") ||
    message.includes("Could not validate credentials") ||
    message.includes("User not found")
  if (isAuthError) return
  console.warn(
    `[repository] API write failed for ${resource}, saved to local cache`,
    error,
  )
  toast.warning(`Saved ${resource} locally only — server sync failed`, {
    duration: 6000,
  })
})

export function TgProviders({ children }: { children: ReactNode }) {
  useBotCredentialMigration()

  return (
    <SettingsProvider>
      <DataProvider>
        <UIProvider>
          <RAGProvider>
            <ScraperProvider>
              <ChatProvider>
                <AIProvider>
                  <CommandPaletteProvider>
                    <TranslationProvider>
                      <TooltipProvider delay={500} closeDelay={300}>
                        {children}
                        <CommandPalette />
                        <MigrationPrompt />
                        <TgToaster richColors closeButton />
                      </TooltipProvider>
                    </TranslationProvider>
                  </CommandPaletteProvider>
                </AIProvider>
              </ChatProvider>
            </ScraperProvider>
          </RAGProvider>
        </UIProvider>
      </DataProvider>
    </SettingsProvider>
  )
}
