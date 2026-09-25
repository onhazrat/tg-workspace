import { useCallback, useEffect, useState } from "react"
import { logger } from "../lib/logger"
import type { Channel, SyncQueueItem } from "../types"

/**
 * The queued items to start now: those not already running, in queue order
 * (newest first, since `addToSyncQueue` prepends), as many as the free
 * concurrency slots allow.
 */
export function nextSyncItems(
  queue: SyncQueueItem[],
  inFlight: ReadonlySet<string>,
  concurrency: number,
): SyncQueueItem[] {
  const free = Math.max(0, concurrency - inFlight.size)
  return queue.filter((item) => !inFlight.has(item.queueId)).slice(0, free)
}

export function useSyncQueue(
  processItem: (channel: Channel, source: string) => Promise<void>,
  summarizing: boolean,
  concurrency = 3,
) {
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([])
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())

  const addToSyncQueue = useCallback(
    (channel: Channel, source: string, onComplete?: () => void) => {
      logger.debug(
        `[SyncQueue] ${new Date().toLocaleTimeString()} - Adding channel @${channel.name} to queue. Source: ${source}`,
      )
      setSyncQueue((prev) => {
        const existing = prev.find((item) => item.channel.id === channel.id)

        if (existing) {
          // If it's already in the queue, just merge the callbacks and keep it where it is
          return prev.map((item) => {
            if (item.channel.id === channel.id) {
              return {
                ...item,
                onComplete: () => {
                  item.onComplete?.()
                  onComplete?.()
                },
              }
            }
            return item
          })
        }

        const newItem: SyncQueueItem = {
          queueId: channel.id,
          channel,
          source,
          timestamp: Date.now(),
          onComplete,
        }

        return [newItem, ...prev]
      })
    },
    [],
  )

  useEffect(() => {
    const processNext = async () => {
      if (summarizing) return
      const nextItems = nextSyncItems(syncQueue, processingIds, concurrency)
      if (nextItems.length === 0) return

      // Mark as processing
      setProcessingIds((prev) => {
        const next = new Set(prev)
        nextItems.forEach((item) => next.add(item.queueId))
        return next
      })

      // Process items in parallel
      nextItems.forEach(async (nextItem) => {
        logger.debug(
          `[SyncQueue] ${new Date().toLocaleTimeString()} - Processing @${nextItem.channel.name} from queue (Source: ${nextItem.source})`,
        )

        try {
          logger.debug(`[SyncQueue] Processing @${nextItem.channel.name}...`)
          await processItem(nextItem.channel, nextItem.source)
          logger.debug(
            `[SyncQueue] Finished processing @${nextItem.channel.name}.`,
          )
          nextItem.onComplete?.()
        } catch (err) {
          console.error(
            `[SyncQueue] Error syncing @${nextItem.channel.name}:`,
            err,
          )
        } finally {
          // Remove from queue and processing set
          setSyncQueue((prev) =>
            prev.filter((item) => item.queueId !== nextItem.queueId),
          )
          setProcessingIds((prev) => {
            const next = new Set(prev)
            next.delete(nextItem.queueId)
            return next
          })
        }
      })
    }

    processNext()
  }, [syncQueue, processingIds, summarizing, processItem, concurrency])

  return {
    syncQueue,
    addToSyncQueue,
    isProcessingQueue: processingIds.size > 0,
    setSyncQueue,
  }
}
