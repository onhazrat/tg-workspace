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
import type { Summary } from "@/types"
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
  const metadataText = summary.metadataText ?? ""
  const plan = useQuery({
    queryKey: queryKeys.publicationPlan(summary.id, {
      ...options,
      metadataText,
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
    await queryClient.invalidateQueries({ queryKey: queryKeys.logs.publish })
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
      citationStyle={settings.citationStyle}
      linkPreviews={settings.linkPreviews}
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
