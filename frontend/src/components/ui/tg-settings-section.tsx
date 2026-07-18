import type { LucideIcon } from "lucide-react"
import type * as React from "react"

import { cn } from "@/lib/utils"

type TgSettingsSectionProps = {
  icon?: LucideIcon
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  headerExtra?: React.ReactNode
  children: React.ReactNode
  className?: string
  headerClassName?: string
  titleClassName?: string
}

/** Card shell + icon header used by Settings hub sections and BotManagement. */
function TgSettingsSection({
  icon: Icon,
  title,
  subtitle,
  actions,
  headerExtra,
  children,
  className,
  headerClassName,
  titleClassName,
}: TgSettingsSectionProps) {
  const hasTitleStack = Boolean(subtitle || headerExtra)
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
          actions ? "justify-between" : null,
          headerClassName,
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 min-w-0",
            hasTitleStack ? "gap-3" : null,
          )}
        >
          {Icon ? (
            <Icon size={16} className="text-app-ink/60 shrink-0" aria-hidden />
          ) : null}
          {hasTitleStack ? (
            <div className="flex flex-col min-w-0">
              <h3
                className={cn(
                  "text-sm font-bold uppercase tracking-widest",
                  titleClassName,
                )}
              >
                {title}
                {headerExtra}
              </h3>
              {subtitle ? (
                <div className="text-[9px] opacity-50 italic serif mt-0.5">
                  {subtitle}
                </div>
              ) : null}
            </div>
          ) : (
            <h3
              className={cn(
                "text-sm font-bold uppercase tracking-widest",
                titleClassName,
              )}
            >
              {title}
            </h3>
          )}
        </div>
        {actions ? (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  )
}

export { TgSettingsSection }
export type { TgSettingsSectionProps }
