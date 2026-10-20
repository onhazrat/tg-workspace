import { FilterRow } from "@/components/filter-tree/FilterRow"
import { useIsVariant1 } from "@/components/time-bound-prototype/variant"
import {
  type ChannelFilter,
  conditionLabel,
  type FilterNames,
} from "@/lib/channels/channel-filter"
import type { MetricData } from "@/lib/channels/channel-metrics"
import {
  CONDITION_ICON,
  type ConditionOptions,
  channelVocabulary,
} from "./ChannelConditionPicker"

/**
 * The Channel filter row (CTB-01), under row 1 while anything filters the
 * grid: the "N of M" count, the search as a chip, then the whole filter as
 * blocks the Account edits (CTB-03). The row is `filter-tree/FilterRow`,
 * shared with the Posts tab; this names the Channels' Conditions for it.
 */
export function ChannelFilterRow({
  names,
  metrics,
  options,
  ...rest
}: {
  filter: ChannelFilter
  onChange: (next: ChannelFilter) => void
  names: FilterNames
  metrics: MetricData
  options: ConditionOptions
  search: string
  shownCount: number
  totalCount: number
  onClearSearch: () => void
  onClearAll: () => void
}) {
  const v1 = useIsVariant1()
  return (
    <FilterRow
      {...rest}
      testId="channel-filter"
      vocabulary={{
        ...channelVocabulary(options, metrics, v1),
        label: (cond) => conditionLabel(cond, names),
        icon: (cond) => CONDITION_ICON[cond.type],
        chipId: (cond) =>
          cond.type === "metric"
            ? `metric-${cond.metric}`
            : cond.type === "time"
              ? `time-${cond.moment}`
              : cond.value,
      }}
    />
  )
}
