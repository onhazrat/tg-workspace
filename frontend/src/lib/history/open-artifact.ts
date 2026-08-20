import type { ArtifactListItem, TabType } from "@/types"

/**
 * Where each artifact kind opens, and under which URL param.
 *
 * Every kind is deep-linkable, following the `?report=` precedent Discover
 * already set: opening an artifact from History is a navigation, so it should
 * survive a reload and be worth copying out of the address bar. Before this,
 * only Discover reports were — summaries were restored through component state
 * and a chat could not be reopened at all.
 */
export interface ArtifactDestination {
  tab: TabType
  param: "summary" | "chatSession" | "tagRun" | "report"
}

export function artifactDestination(
  artifact: ArtifactListItem,
): ArtifactDestination {
  switch (artifact.kind) {
    case "summary":
      return { tab: "summary", param: "summary" }
    case "chat":
      return { tab: "chat", param: "chatSession" }
    case "tag":
      return { tab: "tag", param: "tagRun" }
    case "discovery":
      return { tab: "discover", param: "report" }
  }
}
