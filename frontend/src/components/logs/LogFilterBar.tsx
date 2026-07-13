import { ChevronDown, Filter, Search, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { isAnyLogFilterActive, type LogFilters } from "@/lib/logs/filters"
import { parseDateInputValue, toDateInputValue } from "@/lib/logs/format"
import { LOG_TAB_META, type LogTab } from "@/lib/logs/tabs"
import { formatDateToLocalISO } from "@/lib/utils"

interface LogFilterBarProps {
  activeTab: LogTab
  filters: LogFilters
  onFiltersChange: (patch: Partial<LogFilters>) => void
  showFilters: boolean
  onToggleFilters: () => void
  onClearAllFilters: () => void
  modelOptions: string[]
  botOptions: string[]
  channelOptions: string[]
}

export const LogFilterBar: React.FC<LogFilterBarProps> = ({
  activeTab,
  filters,
  onFiltersChange,
  showFilters,
  onToggleFilters,
  onClearAllFilters,
  modelOptions,
  botOptions,
  channelOptions,
}) => {
  const filterActive = isAnyLogFilterActive(filters)
  const maxDate = formatDateToLocalISO(new Date()).split("T")[0]

  return (
    <>
      <div className="flex gap-2">
        <div className="flex-1 flex gap-2">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30"
            />
            <input
              type="text"
              placeholder={`SEARCH ${LOG_TAB_META[activeTab].label.toUpperCase()} LOGS...`}
              value={filters.searchQuery}
              onChange={(e) => onFiltersChange({ searchQuery: e.target.value })}
              className="w-full bg-app-ink/5 border border-app-ink/10 pl-10 pr-4 py-2 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all uppercase tracking-widest"
            />
            {filters.searchQuery && (
              <button
                type="button"
                onClick={() => onFiltersChange({ searchQuery: "" })}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-30 hover:opacity-100"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 px-3 border border-app-ink/10 bg-app-ink/5">
            <input
              type="checkbox"
              id="search-details"
              checked={filters.searchInDetails}
              onChange={(e) =>
                onFiltersChange({ searchInDetails: e.target.checked })
              }
              className="w-3 h-3 accent-app-ink"
            />
            <label
              htmlFor="search-details"
              className="text-[8px] uppercase font-bold opacity-50 cursor-pointer select-none"
            >
              Search in Details
            </label>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleFilters}
          className={`px-4 flex items-center gap-2 border transition-all text-[10px] uppercase font-bold tracking-tighter ${
            showFilters || filterActive
              ? "bg-app-ink text-app-bg border-app-ink"
              : "bg-app-ink/5 border-app-ink/10 hover:border-app-ink/30"
          }`}
        >
          <Filter size={14} />
          Filters
          <ChevronDown
            size={12}
            className={`transition-transform ${showFilters ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 bg-app-ink/5 border border-app-ink/10 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Status Filter */}
                <div className="space-y-2">
                  <label className="text-[9px] uppercase font-bold opacity-50">
                    Status
                  </label>
                  <div className="flex gap-2">
                    {(["all", "success", "failed"] as const).map((s) => (
                      <button
                        type="button"
                        key={s}
                        onClick={() => onFiltersChange({ statusFilter: s })}
                        className={`px-3 py-1 text-[9px] uppercase font-bold tracking-widest transition-all border ${
                          filters.statusFilter === s
                            ? "bg-app-ink text-app-bg border-app-ink"
                            : "bg-transparent border-app-ink/10 opacity-50 hover:opacity-100"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date Range Filter */}
                <div className="space-y-2 col-span-1 md:col-span-2">
                  <label className="text-[9px] uppercase font-bold opacity-50">
                    Date Range
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="date"
                      value={toDateInputValue(filters.startDate)}
                      max={maxDate}
                      onChange={(e) =>
                        onFiltersChange({
                          startDate: parseDateInputValue(e.target.value),
                        })
                      }
                      className="bg-transparent border border-app-ink/10 px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-app-ink/30"
                    />
                    <span className="opacity-30 text-[10px]">TO</span>
                    <input
                      type="date"
                      value={toDateInputValue(filters.endDate)}
                      max={maxDate}
                      onChange={(e) =>
                        onFiltersChange({
                          endDate: parseDateInputValue(e.target.value),
                        })
                      }
                      className="bg-transparent border border-app-ink/10 px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-app-ink/30"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-app-ink/5">
                {/* Tab Specific Filters */}
                {activeTab === "llm" && (
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase font-bold opacity-50">
                      Model
                    </label>
                    <select
                      value={filters.modelFilter}
                      onChange={(e) =>
                        onFiltersChange({ modelFilter: e.target.value })
                      }
                      className="w-full bg-transparent border border-app-ink/10 px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-app-ink/30"
                    >
                      <option value="all">ALL MODELS</option>
                      {modelOptions.map((m) => (
                        <option key={m} value={m}>
                          {m.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {activeTab === "publish" && (
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase font-bold opacity-50">
                      Bot
                    </label>
                    <select
                      value={filters.botFilter}
                      onChange={(e) =>
                        onFiltersChange({ botFilter: e.target.value })
                      }
                      className="w-full bg-transparent border border-app-ink/10 px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-app-ink/30"
                    >
                      <option value="all">ALL BOTS</option>
                      {botOptions.map((b) => (
                        <option key={b} value={b}>
                          {b.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {activeTab === "sync" && (
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase font-bold opacity-50">
                      Channel
                    </label>
                    <select
                      value={filters.channelFilter}
                      onChange={(e) =>
                        onFiltersChange({ channelFilter: e.target.value })
                      }
                      className="w-full bg-transparent border border-app-ink/10 px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-app-ink/30"
                    >
                      <option value="all">ALL CHANNELS</option>
                      {channelOptions.map((c) => (
                        <option key={c} value={c}>
                          {c.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex items-end md:col-start-3">
                  <button
                    type="button"
                    onClick={onClearAllFilters}
                    disabled={!filterActive}
                    className="w-full py-2 border border-app-ink/10 text-[9px] uppercase font-bold tracking-widest hover:bg-app-ink hover:text-app-bg transition-all disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-app-ink"
                  >
                    Clear All Filters
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
