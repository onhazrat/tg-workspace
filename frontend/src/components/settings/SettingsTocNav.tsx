import { ChevronRight } from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import {
  parentTocId,
  SETTINGS_TOC,
  type SettingsSection,
  type SettingsTocId,
  type SettingsTocNode,
} from "@/lib/settings/toc"
import { scopedStorage } from "@/lib/storage/scoped"
import { cn } from "@/lib/utils"

const EXPAND_STORAGE_KEY = "settings-toc-expanded"

function readStoredExpanded(): Set<SettingsTocId> {
  try {
    const raw = scopedStorage.getItem(EXPAND_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter(
        (id): id is SettingsTocId => typeof id === "string",
      ) as SettingsTocId[],
    )
  } catch {
    return new Set()
  }
}

function writeStoredExpanded(ids: Set<SettingsTocId>) {
  try {
    scopedStorage.setItem(EXPAND_STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    // session-local expand state is enough if storage is unavailable
  }
}

export const SettingsTocNav: React.FC<{
  activeSection: SettingsSection
  onSelect: (section: SettingsSection) => void
}> = ({ activeSection, onSelect }) => {
  const [expanded, setExpanded] = useState<Set<SettingsTocId>>(() =>
    readStoredExpanded(),
  )

  // Ensure the active leaf's parent is expanded (deep-link / palette / URL).
  useEffect(() => {
    const parent = parentTocId(activeSection)
    if (!parent) return
    setExpanded((prev) => {
      if (prev.has(parent)) return prev
      const next = new Set(prev)
      next.add(parent)
      writeStoredExpanded(next)
      return next
    })
  }, [activeSection])

  const setExpandedIds = (
    updater: (prev: Set<SettingsTocId>) => Set<SettingsTocId>,
  ) => {
    setExpanded((prev) => {
      const next = updater(prev)
      writeStoredExpanded(next)
      return next
    })
  }

  const toggleExpand = (id: SettingsTocId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSelect = (node: SettingsTocNode) => {
    if (node.children?.length) {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        next.add(node.id)
        return next
      })
    }
    onSelect(node.id)
  }

  const renderTree = (nodes: SettingsTocNode[], depth = 0) =>
    nodes.map((node) => {
      const isActive = activeSection === node.id
      const hasChildren = Boolean(node.children?.length)
      const isExpanded = hasChildren && expanded.has(node.id)
      const Icon = node.icon

      return (
        <div key={node.id}>
          <div
            className={cn(
              "flex w-full items-center gap-0.5 rounded-sm transition-all",
              depth > 0 && "pl-3",
              isActive
                ? "bg-app-ink text-app-bg font-bold"
                : "opacity-60 hover:opacity-100 hover:bg-app-ink/5",
            )}
          >
            {hasChildren ? (
              <button
                type="button"
                aria-label={
                  isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`
                }
                aria-expanded={isExpanded}
                data-testid={`toc-twistie-${node.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  toggleExpand(node.id)
                }}
                className={cn(
                  "flex h-7 w-5 shrink-0 items-center justify-center rounded-sm",
                  isActive
                    ? "text-app-bg/80 hover:bg-app-bg/10"
                    : "hover:bg-app-ink/10",
                )}
              >
                <ChevronRight
                  size={12}
                  className={cn(
                    "transition-transform duration-150",
                    isExpanded && "rotate-90",
                  )}
                />
              </button>
            ) : (
              <span className="w-5 shrink-0" aria-hidden />
            )}
            <button
              type="button"
              onClick={() => handleSelect(node)}
              data-testid={`toc-section-${node.id}`}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 py-2 pr-3 text-left text-[11px] font-mono uppercase tracking-widest",
                depth > 0 && "text-[10px]",
              )}
            >
              <Icon size={depth > 0 ? 12 : 14} className="shrink-0" />
              <span className="truncate">{node.label}</span>
            </button>
          </div>
          {isExpanded && node.children
            ? renderTree(node.children, depth + 1)
            : null}
        </div>
      )
    })

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Settings sections">
      {renderTree(SETTINGS_TOC)}
    </nav>
  )
}
