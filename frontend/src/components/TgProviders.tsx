import type { ReactNode } from "react"
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
import { TagProvider } from "@/contexts/TagContext"
import { TranslationProvider } from "@/contexts/TranslationContext"
import { UIProvider } from "@/contexts/UIContext"
import { useBotCredentialMigration } from "@/hooks/useBotCredentialMigration"
import { migrateEmbeddingsData, migrateSummaryDates } from "@/lib/cache"

migrateEmbeddingsData().catch(console.error)
migrateSummaryDates().catch(console.error)

// The "saved locally only — server sync failed" toast is gone with A3's write
// fallback. It promised something no longer true: with the IndexedDB mirror
// retired there is no local copy for a failed write to land in, so telling the
// operator their data was saved would be a lie. A failed write now surfaces as
// the error it is.

export function TgProviders({ children }: { children: ReactNode }) {
  useBotCredentialMigration()

  return (
    <SettingsProvider>
      <DataProvider>
        <UIProvider>
          <RAGProvider>
            <ScraperProvider>
              <TagProvider>
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
              </TagProvider>
            </ScraperProvider>
          </RAGProvider>
        </UIProvider>
      </DataProvider>
    </SettingsProvider>
  )
}
