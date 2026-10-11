import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import {
  dataPlanSummaryPublication,
  dataSendSummaryPublication,
  type PublicationSendRequest,
} from "@/client"
import { useSettings } from "@/contexts/SettingsContext"
import { queryKeys } from "@/hooks/queryKeys"
import { useBotCredentials, useChatDestinations } from "@/hooks/useBots"
import { errorText } from "@/lib/artifacts/artifact-run"
import type { PublishingOptions, Summary } from "@/types"
import { PublishPanel } from "./PublishPanel"
import { publicationToast } from "./publish-panel-model"

const workspaceRoute = getRouteApi("/_tg/workspace")

/**
 * The publish panel wired to the server: the plan route for the preview, the
 * Publication route for the send. Remount per Summary (`key`), so the options
 * start from the one on screen.
 */
export function SummaryPublishPanel({
  summary,
  onSave,
}: {
  summary: Summary
  onSave: (patch: Partial<Summary>) => Promise<void>
}) {
  const settings = useSettings()
  const bots = useBotCredentials()
  const destinations = useChatDestinations()
  const queryClient = useQueryClient()
  const navigate = workspaceRoute.useNavigate()
  const [options, setOptions] = useState({
    includeMetadata: summary.sendMetadata === true,
    metadataInFirstPart: summary.metadataInFirstPart === true,
  })
  // Only what this Summary changed; the rest follows Settings, on the server
  // as here.
  const [ownPublishing, setOwnPublishing] = useState(summary.publishing ?? {})
  const publishing: PublishingOptions = {
    citationStyle: ownPublishing.citationStyle ?? settings.citationStyle,
    linkPreviews: ownPublishing.linkPreviews ?? settings.linkPreviews,
    timeZone: ownPublishing.timeZone ?? settings.timeZone,
  }
  const metadataText = summary.metadataText ?? ""
  const plan = useQuery({
    queryKey: queryKeys.publicationPlan(summary.id, {
      ...options,
      metadataText,
      metadataOmittedRows: summary.metadataOmittedRows ?? [],
      // The saved copy, not the pick: the plan reads it from the row.
      publishing: summary.publishing ?? null,
      defaults: [
        settings.citationStyle,
        settings.linkPreviews,
        settings.timeZone,
      ],
      text: summary.text,
    }),
    queryFn: () =>
      dataPlanSummaryPublication({
        path: { summary_id: summary.id },
        body: options,
      }),
    placeholderData: keepPreviousData,
  })

  const publish = async (send: PublicationSendRequest) => {
    try {
      const result = await dataSendSummaryPublication({
        path: { summary_id: summary.id },
        body: send,
      })
      const said = publicationToast(result)
      toast[said.kind](said.text)
    } catch (err) {
      toast.error(`Error publishing: ${errorText(err, "unknown error")}`)
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.logs.publish }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.publicationPlans(summary.id),
      }),
    ])
  }

  return (
    <PublishPanel
      bots={bots}
      destinations={destinations}
      plan={plan.data}
      options={options}
      onOptionsChange={(next) => {
        setOptions(next)
        void onSave({
          sendMetadata: next.includeMetadata,
          metadataInFirstPart: next.metadataInFirstPart,
        })
      }}
      metadataText={metadataText}
      onSaveMetadataText={(text) => onSave({ metadataText: text })}
      onSaveOmittedRows={(keys) => onSave({ metadataOmittedRows: keys })}
      publishing={publishing}
      publishingCustomized={Object.keys(ownPublishing).length > 0}
      onPublishingChange={(change) => {
        // Picking what it already publishes with changes nothing, so it does
        // not stop the Summary following Settings.
        const same = Object.entries(change).every(
          ([key, value]) =>
            publishing[key as keyof PublishingOptions] === value,
        )
        if (same) return
        const next = { ...ownPublishing, ...change }
        setOwnPublishing(next)
        void onSave({ publishing: next })
      }}
      onPublishingReset={() => {
        setOwnPublishing({})
        // An explicit null is what removes it from the Summary.
        void onSave({ publishing: null })
      }}
      onOpenSettings={() =>
        navigate({
          search: (prev) => ({
            ...prev,
            tab: "settings" as const,
            section: "publishing" as const,
          }),
        })
      }
      onPublish={publish}
    />
  )
}
