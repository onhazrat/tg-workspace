/**
 * An Artifact's frozen Analysis window, wherever an Artifact is shown (AW-08).
 *
 * One component for all four families rather than a line of JSX per surface,
 * because the rule it carries is a rule about Artifacts and not about any one
 * of them: exact local boundaries, derived Duration, no End gap, no "ago" and
 * no former workspace mode. Those last three describe a window that is still
 * moving, and an Artifact's has stopped.
 *
 * The restore button is here for the same reason — the action belongs beside
 * the boundaries it would apply, and putting it anywhere else is how one of the
 * four ends up without it.
 */

import { Clock } from "lucide-react"
import type React from "react"

import type { FrozenScope } from "@/client"
import { TgButton } from "@/components/ui/tg-button"
import { useApplyArtifactScope } from "@/hooks/useApplyArtifactScope"
import { artifactWindowText } from "@/lib/scope/artifact-scope"

interface ArtifactScopeLineProps {
  /** Anything carrying a frozen Scope: a list row or a detail response. */
  artifact: { scope?: FrozenScope | null } | null | undefined
  className?: string
}

export const ArtifactScopeLine: React.FC<ArtifactScopeLineProps> = ({
  artifact,
  className,
}) => {
  const applyScope = useApplyArtifactScope()
  const scope = artifact?.scope
  const windowText = artifactWindowText(artifact)

  // A row a legacy `PUT` opened records no Scope, and AW-07 left nothing to
  // fall back to. Saying so is the honest answer; there is also nothing to
  // restore, so the action goes with it.
  if (!scope || !windowText) {
    return (
      <p
        data-testid="artifact-scope-line"
        className={`text-[11px] font-mono text-app-ink/50 ${className ?? ""}`}
      >
        Analysis window: not recorded
      </p>
    )
  }

  return (
    <div
      data-testid="artifact-scope-line"
      className={`flex min-w-0 flex-wrap items-center gap-2 text-[11px] font-mono text-app-ink/60 ${className ?? ""}`}
    >
      <Clock size={12} className="shrink-0 opacity-60" />
      <span className="min-w-0 break-words">{windowText}</span>
      <TgButton
        size="sm"
        variant="secondary"
        data-testid="use-this-scope"
        onClick={() => applyScope(scope)}
      >
        Use this Scope
      </TgButton>
    </div>
  )
}
