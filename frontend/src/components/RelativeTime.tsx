import type React from "react"
import { useEffect, useState } from "react"
import { subscribeToTick } from "@/lib/shared-ticker"
import { getRelativeTime } from "../lib/utils"

interface RelativeTimeProps {
  timestamp?: number
  className?: string
}

export const RelativeTime: React.FC<RelativeTimeProps> = ({
  timestamp,
  className,
}) => {
  const [relativeTime, setRelativeTime] = useState(getRelativeTime(timestamp))
  const absoluteTime = timestamp ? new Date(timestamp).toLocaleString() : ""

  useEffect(() => {
    // Update immediately when timestamp changes
    setRelativeTime(getRelativeTime(timestamp))

    if (!timestamp) return

    // One shared interval for every instance — a long feed used to schedule
    // one timer per rendered timestamp.
    return subscribeToTick(() => {
      setRelativeTime(getRelativeTime(timestamp))
    })
  }, [timestamp])

  return (
    <span className={className} title={absoluteTime || undefined}>
      {relativeTime}
    </span>
  )
}
