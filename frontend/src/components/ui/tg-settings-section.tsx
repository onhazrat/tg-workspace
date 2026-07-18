import type { LucideIcon } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

type TgSettingsSectionProps = {
  icon?: LucideIcon
  title: React.ReactNode
  children: React.ReactNode
  className?: string
  headerClassName?: string
  titleClassName?: string
}

/** Card shell + icon header used by Settings hub sections and BotManagement. */
function TgSettingsSection({
  icon: Icon,
  title,
  children,
  className,
  headerClassName,
  titleClassName,
}: TgSettingsSectionProps) {
  return (
    <section
      data-slot="tg-settings-section"
      className={cn(
        "bg-app-card border border-app-ink/10 p-6 shadow-sm rounded-sm",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 mb-6",
          headerClassName,
        )}
      >
        {Icon ? (
          <Icon size={16} className="text-app-ink/60 shrink-0" aria-hidden />
        ) : null}
        <h3
          className={cn(
            "text-sm font-bold uppercase tracking-widest",
            titleClassName,
          )}
        >
          {title}
        </h3>
      </div>
      {children}
    </section>
  )
}

export { TgSettingsSection }
export type { TgSettingsSectionProps }
