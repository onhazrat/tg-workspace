import { Cpu, Database, Languages, RefreshCw, Thermometer } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { LANGUAGES, MODELS } from "@/constants"
import { useSettings } from "@/contexts/SettingsContext"
import { ToggleSwitch } from "./ToggleSwitch"

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
      {/* AI Configuration */}
      <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <Cpu size={18} className="opacity-40" />
          <h4 className="text-[11px] uppercase font-bold tracking-widest">
            AI Engine Parameters
          </h4>
        </div>

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
              className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all"
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l} className="bg-app-card text-app-ink">
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
            <p className="text-[10px] opacity-40 italic serif">
              Summaries and chat responses will be generated in this language.
            </p>
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
              className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all"
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
            <p className="text-[10px] opacity-40 italic serif">
              Flash models are faster, Pro models are more detailed.
            </p>
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
                  <ToggleSwitch
                    checked={embeddingsEnabled}
                    onClick={() => setEmbeddingsEnabled(!embeddingsEnabled)}
                  />
                </div>
                <p className="text-[10px] opacity-40 italic serif">
                  Generate vector embeddings for posts to enable semantic search
                  and RAG chat. Warning: Takes significant disk space.
                </p>
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
                    <ToggleSwitch
                      checked={embeddingsPaused}
                      onClick={() => setEmbeddingsPaused(!embeddingsPaused)}
                      tone="amber"
                    />
                  </div>
                  <p className="text-[10px] opacity-40 italic serif">
                    Temporarily pause the background generation of embeddings to
                    save API quota or CPU usage.
                  </p>
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
              <input
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
                className="w-20 bg-app-ink/5 border border-app-ink/10 p-2 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all rounded"
              />
              <span className="text-[10px] opacity-60 uppercase tracking-widest font-bold">
                0 = precise · 1 = creative
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Translation Configuration */}
      {advancedMode && (
        <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm mt-8">
          <div className="flex items-center gap-3 mb-6">
            <Languages size={18} className="opacity-40" />
            <h4 className="text-[11px] uppercase font-bold tracking-widest">
              Translation Engine
            </h4>
          </div>

          <div className="space-y-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 opacity-60">
                  <Languages size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-tight">
                    Enable Translation
                  </span>
                </div>
                <ToggleSwitch
                  checked={translationEnabled}
                  onClick={() => setTranslationEnabled(!translationEnabled)}
                />
              </div>
              <p className="text-[10px] opacity-40 italic serif">
                Allow translating posts natively using Gemini.
              </p>
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
                      <ToggleSwitch
                        checked={autoTranslate}
                        onClick={() => setAutoTranslate(!autoTranslate)}
                      />
                    </div>
                    <p className="text-[10px] opacity-40 italic serif">
                      Automatically translate posts when they are loaded.
                    </p>
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
                      className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all"
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
                      className="w-full bg-app-ink/5 border border-app-ink/10 p-3 text-[10px] font-mono uppercase tracking-widest focus:outline-none focus:border-app-ink/30 transition-all"
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
        </div>
      )}
    </div>
  )
}
