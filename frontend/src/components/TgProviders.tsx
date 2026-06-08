import type { ReactNode } from "react"

import { AIProvider } from "@/contexts/AIContext"
import { ChatProvider } from "@/contexts/ChatContext"
import { DataProvider } from "@/contexts/DataContext"
import { RAGProvider } from "@/contexts/RAGContext"
import { ScraperProvider } from "@/contexts/ScraperContext"
import { SettingsProvider } from "@/contexts/SettingsContext"
import { TranslationProvider } from "@/contexts/TranslationContext"
import { UIProvider } from "@/contexts/UIContext"
import { TgToaster } from "@/components/ui/tg-sonner"
import { TooltipProvider } from "@/components/ui/tg-tooltip"
import { migrateEmbeddingsData, migrateSummaryDates } from "@/lib/db"

migrateEmbeddingsData().catch(console.error)
migrateSummaryDates().catch(console.error)

export function TgProviders({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <DataProvider>
        <UIProvider>
          <RAGProvider>
            <ScraperProvider>
              <ChatProvider>
                <AIProvider>
                  <TranslationProvider>
                    <TooltipProvider delay={500} closeDelay={300}>
                      {children}
                      <TgToaster richColors closeButton />
                    </TooltipProvider>
                  </TranslationProvider>
                </AIProvider>
              </ChatProvider>
            </ScraperProvider>
          </RAGProvider>
        </UIProvider>
      </DataProvider>
    </SettingsProvider>
  )
}
