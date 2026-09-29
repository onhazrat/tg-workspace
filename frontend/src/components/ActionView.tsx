import { motion } from "motion/react"
import type React from "react"
import { AnalysisWindowLink } from "@/components/AnalysisWindowControl"
import { ChatAction } from "@/components/action/ChatAction"
import { DiscoverAction } from "@/components/action/DiscoverAction"
import { RunSettingsBar } from "@/components/action/RunSettingsBar"
import { SummaryAction } from "@/components/action/SummaryAction"
import { TagAction } from "@/components/action/TagAction"

/**
 * The one place you start work.
 *
 * Each of the four AI features used to own both its create form and its result
 * view, so making something meant knowing which of four tabs to open first.
 * The create halves live here now; the feature tabs render results only.
 *
 * One card, one row per action, every row on the same columns (`ActionRow`),
 * so every Run button lines up on the right. Adding an action is a component
 * that renders an `ActionRow` and one line in the list below.
 *
 * The order is what each action reads. Posts first, because reading posts is
 * what the workspace is for: Summarize and Chat run over the Analysis window.
 * Channels second: Tag and Discover run over the selected channels. Within
 * each, the one reached for most often comes first.
 *
 * What every action shares sits once, in the card's header: the Analysis
 * window they run over and the Key, model and language they run with. Discover
 * reads neither of the last three — its report is a server-side aggregation
 * with no inference in it.
 */
export const ActionView: React.FC = () => (
  <motion.div
    key="action"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -20 }}
  >
    <section className="overflow-hidden rounded-xl border border-app-ink/10 bg-app-card shadow-sm">
      <header className="flex flex-col gap-3 border-b border-app-ink/10 bg-app-muted/20 p-4 lg:flex-row lg:items-center">
        {/*
         * What the actions below run over (AW-09).
         *
         * Read-only on purpose: this is the same line the Posts editor's
         * trigger draws, and activating it goes there rather than opening a
         * second copy of the editor here. Every draft on this tab survives the
         * trip.
         */}
        <div
          data-testid="action-scope"
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-app-ink/50">
            Runs over
          </span>
          <div className="min-w-0 flex-1">
            <AnalysisWindowLink />
          </div>
        </div>
        <RunSettingsBar />
      </header>
      <ul className="divide-y divide-app-ink/10">
        <SummaryAction />
        <ChatAction />
        <TagAction />
        <DiscoverAction />
      </ul>
    </section>
  </motion.div>
)
