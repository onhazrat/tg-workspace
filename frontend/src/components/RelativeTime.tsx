import type React from "react"
import { useEffect, useState } from "react"
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

    const interval = setInterval(() => {
      setRelativeTime(getRelativeTime(timestamp))
    }, 10000) // Update every 10 seconds for better responsiveness

    return () => clearInterval(interval)
  }, [timestamp])

  return (
    <span className={className} title={absoluteTime || undefined}>
      {relativeTime}
    </span>
  )
}
