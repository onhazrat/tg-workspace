import { XCircle } from "lucide-react"
import type React from "react"
import { RelativeTime } from "@/components/RelativeTime"
import type { LogStatus } from "@/lib/logs/filters"

export type LogAccent = "green" | "blue" | "purple" | "teal" | "orange"

const ACCENT_CLASSES: Record<LogAccent, { border: string; bubble: string }> = {
  green: {
    border: "border-l-green-500",
    bubble: "bg-green-500/10 text-green-600",
  },
  blue: {
    border: "border-l-blue-500",
    bubble: "bg-blue-500/10 text-blue-600",
  },
  purple: {
    border: "border-l-purple-500",
    bubble: "bg-purple-500/10 text-purple-600",
  },
  teal: {
    border: "border-l-teal-500",
    bubble: "bg-teal-500/10 text-teal-600",
  },
  orange: {
    border: "border-l-orange-500",
    bubble: "bg-orange-500/10 text-orange-600",
  },
}

interface LogCardProps {
  status: LogStatus
  /** Accent color used for the left border and icon bubble on success. */
  accent: LogAccent
  /** Icon shown in the bubble on success; failures always show XCircle. */
  successIcon: React.ReactNode
  title: string
  timestamp: number
  /** Meta items rendered in the row under the title (see LogMetaItem). */
  meta: React.ReactNode
  /** Action buttons rendered on the right side of the header. */
  actions: React.ReactNode
  children?: React.ReactNode
}

export const LogCard: React.FC<LogCardProps> = ({
  status,
  accent,
  successIcon,
  title,
  timestamp,
  meta,
  actions,
  children,
}) => {
  const accentClasses = ACCENT_CLASSES[accent]
  return (
    <div
      className={`group border border-app-ink border-opacity-10 p-4 transition-all hover:border-opacity-30 bg-app-card ${
        status === "failed"
          ? "border-l-4 border-l-red-500"
          : `border-l-4 ${accentClasses.border}`
      }`}
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-full ${status === "success" ? accentClasses.bubble : "bg-red-500/10 text-red-600"}`}
          >
            {status === "success" ? successIcon : <XCircle size={16} />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest">
                {title}
              </span>
              <span className="text-[9px] opacity-30 font-mono">
                <RelativeTime timestamp={timestamp} />
              </span>
            </div>
            <div className="flex items-center gap-4 mt-1">{meta}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
      {children}
    </div>
  )
}

interface LogMetaItemProps {
  icon: React.ReactNode
  spanClassName?: string
  children: React.ReactNode
}

export const LogMetaItem: React.FC<LogMetaItemProps> = ({
  icon,
  spanClassName,
  children,
}) => (
  <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
    {icon}
    <span className={spanClassName}>{children}</span>
  </div>
)
