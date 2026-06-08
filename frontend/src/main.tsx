import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { SettingsProvider } from './contexts/SettingsContext.tsx';
import { DataProvider } from './contexts/DataContext.tsx';
import { UIProvider } from './contexts/UIContext.tsx';
import { RAGProvider } from './contexts/RAGContext.tsx';
import { ScraperProvider } from './contexts/ScraperContext.tsx';
import { ChatProvider } from './contexts/ChatContext.tsx';
import { AIProvider } from './contexts/AIContext.tsx';
import { TranslationProvider } from './contexts/TranslationContext.tsx';
import { TooltipProvider } from './components/ui/tooltip.tsx';
import { migrateEmbeddingsData, migrateSummaryDates } from './lib/db.ts';

// Safely override showPicker to prevent SecurityError in cross-origin iframes
if (typeof HTMLSelectElement !== 'undefined' && HTMLSelectElement.prototype.showPicker) {
  const originalSelectShowPicker = HTMLSelectElement.prototype.showPicker;
  HTMLSelectElement.prototype.showPicker = function() {
    try {
      originalSelectShowPicker.call(this);
    } catch (e: any) {
      if (e.name === 'SecurityError') {
        console.warn('showPicker() blocked by cross-origin iframe policy.');
      } else {
        throw e;
      }
    }
  };
}

if (typeof HTMLInputElement !== 'undefined' && HTMLInputElement.prototype.showPicker) {
  const originalInputShowPicker = HTMLInputElement.prototype.showPicker;
  HTMLInputElement.prototype.showPicker = function() {
    try {
      originalInputShowPicker.call(this);
    } catch (e: any) {
      if (e.name === 'SecurityError') {
        console.warn('showPicker() blocked by cross-origin iframe policy.');
      } else {
        throw e;
      }
    }
  };
}

// Run one-time migrations
migrateEmbeddingsData().catch(console.error);
migrateSummaryDates().catch(console.error);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <DataProvider>
        <UIProvider>
          <RAGProvider>
            <ScraperProvider>
              <ChatProvider>
                <AIProvider>
                  <TranslationProvider>
                    <TooltipProvider delay={500} closeDelay={300}>
                      <App />
                    </TooltipProvider>
                  </TranslationProvider>
                </AIProvider>
              </ChatProvider>
            </ScraperProvider>
          </RAGProvider>
        </UIProvider>
      </DataProvider>
    </SettingsProvider>
  </StrictMode>,
);
