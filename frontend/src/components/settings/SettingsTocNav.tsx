import type React from "react"
import {
  parentTocId,
  SETTINGS_TOC,
  type SettingsSection,
  type SettingsTocNode,
} from "@/lib/settings/toc"
import { cn } from "@/lib/utils"

export const SettingsTocNav: React.FC<{
  activeSection: SettingsSection
  onSelect: (section: SettingsSection) => void
}> = ({ activeSection, onSelect }) => {
  const renderTree = (nodes: SettingsTocNode[], depth = 0) =>
    nodes.map((node) => {
      const isActive = activeSection === node.id
      const isAncestor = parentTocId(activeSection) === node.id
      const Icon = node.icon
      return (
        <div key={node.id}>
          <button
            type="button"
            onClick={() => onSelect(node.id)}
            className={cn(
              "flex w-full items-center gap-3 px-3 py-2 text-left text-[11px] font-mono uppercase tracking-widest transition-all rounded-sm",
              isActive
                ? "bg-app-ink text-app-bg font-bold"
                : "opacity-60 hover:opacity-100 hover:bg-app-ink/5",
              depth > 0 && "pl-6 text-[10px]",
            )}
          >
            <Icon size={depth > 0 ? 12 : 14} />
            {node.label}
          </button>
          {(isActive || isAncestor) && node.children
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
