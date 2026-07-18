import { Cpu, Database, Languages, RefreshCw, Thermometer } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { TgHelpText, TgInput, tgFieldClassName } from "@/components/ui/tg-input"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import { TgToggle } from "@/components/ui/tg-toggle"
import { LANGUAGES, MODELS } from "@/constants"
import { useSettings } from "@/contexts/SettingsContext"

export const AiSection: React.FC = () => {
  const {
    aiLanguage,
    setAiLanguage,
    selectedModel,
    setSelectedModel,
    aiTemperature,
    setAiTemperature,
    embeddingsEnabled,
    setEmbeddingsEnabled,
    embeddingsPaused,
    setEmbeddingsPaused,
    translationEnabled,
    setTranslationEnabled,
    autoTranslate,
    setAutoTranslate,
    translationModel,
    setTranslationModel,
    translationTargetLanguage,
    setTranslationTargetLanguage,
    advancedMode,
  } = useSettings()

  return (
    <div className="space-y-8 lg:col-span-2">
      <TgSettingsSection icon={Cpu} title="AI Engine Parameters">
        <div className="space-y-8">
          <div className="space-y-4">
            <div className="flex items-center gap-2 opacity-60">
              <Languages size={14} />
              <span className="text-[10px] font-bold uppercase tracking-tight">
                Output Language
              </span>
            </div>
            <select
              value={aiLanguage}
              onChange={(e) => setAiLanguage(e.target.value)}
              className={tgFieldClassName}
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l} className="bg-app-card text-app-ink">
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
            <TgHelpText>
              Summaries and chat responses will be generated in this language.
            </TgHelpText>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 opacity-60">
              <Cpu size={14} />
              <span className="text-[10px] font-bold uppercase tracking-tight">
                Default Model
              </span>
            </div>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className={tgFieldClassName}
            >
              {MODELS.map((m) => (
                <option
                  key={m.id}
                  value={m.id}
                  className="bg-app-card text-app-ink"
                >
                  {m.label.toUpperCase()}
                </option>
              ))}
            </select>
            <TgHelpText>
              Flash models are faster, Pro models are more detailed.
            </TgHelpText>
          </div>

          {advancedMode && (
            <>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 opacity-60">
                    <Cpu size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Enable Embeddings & RAG
                    </span>
                  </div>
                  <TgToggle
                    checked={embeddingsEnabled}
                    onClick={() => setEmbeddingsEnabled(!embeddingsEnabled)}
                  />
                </div>
                <TgHelpText>
                  Generate vector embeddings for posts to enable semantic search
                  and RAG chat. Warning: Takes significant disk space.
                </TgHelpText>
              </div>

              {embeddingsEnabled && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 opacity-60">
                      <Database size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-tight">
                        Pause Embedding Sync
                      </span>
                    </div>
                    <TgToggle
                      checked={embeddingsPaused}
                      onClick={() => setEmbeddingsPaused(!embeddingsPaused)}
                      tone="amber"
                    />
                  </div>
                  <TgHelpText>
                    Temporarily pause the background generation of embeddings to
                    save API quota or CPU usage.
                  </TgHelpText>
                </div>
              )}
            </>
          )}

          <div className="space-y-4">
            <div className="flex items-center gap-2 opacity-60">
              <Thermometer size={14} />
              <span className="text-[10px] font-bold uppercase tracking-tight">
                Creativity (Temperature)
              </span>
            </div>
            <div className="flex items-center gap-3">
              <TgInput
                type="number"
                min={0}
                max={1}
                step="any"
                value={aiTemperature}
                onChange={(e) => {
                  const val = Number.parseFloat(e.target.value)
                  if (!Number.isNaN(val)) {
                    setAiTemperature(Math.min(1, Math.max(0, val)))
                  }
                }}
                className="w-20 p-2 normal-case tracking-normal rounded"
              />
              <span className="text-[10px] opacity-60 uppercase tracking-widest font-bold">
                0 = precise · 1 = creative
              </span>
            </div>
          </div>
        </div>
      </TgSettingsSection>

      {advancedMode && (
        <TgSettingsSection icon={Languages} title="Translation Engine">
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 opacity-60">
                  <Languages size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-tight">
                    Enable Translation
                  </span>
                </div>
                <TgToggle
                  checked={translationEnabled}
                  onClick={() => setTranslationEnabled(!translationEnabled)}
                />
              </div>
              <TgHelpText>
                Allow translating posts natively using Gemini.
              </TgHelpText>
            </div>

            <AnimatePresence>
              {translationEnabled && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-6 overflow-hidden"
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 opacity-60">
                        <RefreshCw size={14} />
                        <span className="text-[10px] font-bold uppercase tracking-tight">
                          Auto-Translate Posts
                        </span>
                      </div>
                      <TgToggle
                        checked={autoTranslate}
                        onClick={() => setAutoTranslate(!autoTranslate)}
                      />
                    </div>
                    <TgHelpText>
                      Automatically translate posts when they are loaded.
                    </TgHelpText>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-2 opacity-60">
                      <Languages size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-tight">
                        Target Language
                      </span>
                    </div>
                    <select
                      value={translationTargetLanguage}
                      onChange={(e) =>
                        setTranslationTargetLanguage(e.target.value)
                      }
                      className={tgFieldClassName}
                    >
                      {LANGUAGES.map((l) => (
                        <option
                          key={l}
                          value={l}
                          className="bg-app-card text-app-ink"
                        >
                          {l.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-2 opacity-60">
                      <Cpu size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-tight">
                        Translation Model
                      </span>
                    </div>
                    <select
                      value={translationModel}
                      onChange={(e) => setTranslationModel(e.target.value)}
                      className={tgFieldClassName}
                    >
                      {MODELS.map((m) => (
                        <option
                          key={m.id}
                          value={m.id}
                          className="bg-app-card text-app-ink"
                        >
                          {m.label.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </TgSettingsSection>
      )}
    </div>
  )
}
