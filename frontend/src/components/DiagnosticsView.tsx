import { motion } from "motion/react"
import type React from "react"
import { LogsView } from "./LogsView"

/** System / LLM / sync / embedding / publish / network log tabs. */
export const DiagnosticsView: React.FC = () => {
  return (
    <motion.div
      key="diagnostics"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 pb-20"
    >
      <LogsView />
    </motion.div>
  )
}
