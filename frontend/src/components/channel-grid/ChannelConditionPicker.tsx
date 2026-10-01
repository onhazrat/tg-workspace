import { Languages, Layers, SlidersHorizontal, Tag } from "lucide-react"
import type {
  ConditionOption,
  PickerVocabulary,
} from "@/components/filter-tree/ConditionPicker"
import type { Cond, CondType } from "@/lib/channels/channel-filter"
import { METRICS, type MetricData } from "@/lib/channels/channel-metrics"
import { ChannelMetricEditor } from "./ChannelMetricEditor"

export type { ConditionOption }
/** What the picker offers for each kind of Condition. */
export type ConditionOptions = Record<CondType, ConditionOption[]>

export const CONDITION_ICON: Record<Cond["type"], typeof Tag> = {
  tag: Tag,
  group: Layers,
  language: Languages,
  metric: SlidersHorizontal,
}

const KINDS: [CondType, string][] = [
  ["tag", "Tag"],
  ["group", "Setting group"],
  ["language", "Language"],
]

/**
 * The Channels' Conditions as the shared condition picker reads them (CTB-03):
 * a tag, Setting group or Language by name, or a number through its editor.
 */
export function channelVocabulary(
  options: ConditionOptions,
  metrics: MetricData,
): PickerVocabulary<Cond> {
  return {
    sections: [
      {
        entries: KINDS.map(([type, label]) => ({
          kind: "list" as const,
          id: type,
          label,
          icon: CONDITION_ICON[type],
          options: options[type],
          make: (value: string): Cond => ({ type, value }),
          current: (cond: Cond) =>
            cond.type === type ? cond.value : undefined,
        })),
      },
      {
        heading: "Numbers",
        entries: METRICS.map((m) => ({
          kind: "editor" as const,
          id: `metric:${m.key}`,
          label: m.label,
          icon: SlidersHorizontal,
          render: ({ start, onSubmit, onBack }) => (
            <ChannelMetricEditor
              metricKey={m.key}
              data={metrics}
              initial={start?.type === "metric" ? start : undefined}
              onBack={onBack}
              onSubmit={(bound) =>
                onSubmit({ type: "metric", metric: m.key, ...bound })
              }
            />
          ),
        })),
      },
    ],
    entryOf: (cond) =>
      cond.type === "metric" ? `metric:${cond.metric}` : cond.type,
  }
}
