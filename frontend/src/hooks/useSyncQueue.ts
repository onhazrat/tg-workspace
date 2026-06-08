import { useState, useEffect, useCallback } from "react";
import { Channel, SyncQueueItem } from "../types";

export function useSyncQueue(
  processItem: (channel: Channel, source: string) => Promise<void>,
  summarizing: boolean,
  concurrency = 3
) {
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  const addToSyncQueue = useCallback((channel: Channel, source: string, onComplete?: () => void) => {
    console.log(`[SyncQueue] ${new Date().toLocaleTimeString()} - Adding channel @${channel.name} to queue. Source: ${source}`);
    setSyncQueue(prev => {
      const existing = prev.find(item => item.channel.id === channel.id);
      
      if (existing) {
        // If it's already in the queue, just merge the callbacks and keep it where it is
        return prev.map(item => {
          if (item.channel.id === channel.id) {
            return {
              ...item,
              onComplete: () => {
                item.onComplete?.();
                onComplete?.();
              }
            };
          }
          return item;
        });
      }
      
      const newItem: SyncQueueItem = { 
        queueId: channel.id,
        channel, 
        source, 
        timestamp: Date.now(),
        onComplete
      };
      
      return [newItem, ...prev];
    });
  }, []);

  useEffect(() => {
    const processNext = async () => {
      if (syncQueue.length === 0 || summarizing || processingIds.size >= concurrency) return;

      // Find items that are not currently being processed
      const nextItems = syncQueue.filter(item => !processingIds.has(item.queueId)).slice(0, concurrency - processingIds.size);
      
      if (nextItems.length === 0) return;

      // Mark as processing
      setProcessingIds(prev => {
        const next = new Set(prev);
        nextItems.forEach(item => next.add(item.queueId));
        return next;
      });

      // Process items in parallel
      nextItems.forEach(async (nextItem) => {
        console.log(`[SyncQueue] ${new Date().toLocaleTimeString()} - Processing @${nextItem.channel.name} from queue (Source: ${nextItem.source})`);
        
        try {
          console.log(`[SyncQueue] Processing @${nextItem.channel.name}...`);
          await processItem(nextItem.channel, nextItem.source);
          console.log(`[SyncQueue] Finished processing @${nextItem.channel.name}.`);
          nextItem.onComplete?.();
        } catch (err) {
          console.error(`[SyncQueue] Error syncing @${nextItem.channel.name}:`, err);
        } finally {
          // Remove from queue and processing set
          setSyncQueue(prev => prev.filter(item => item.queueId !== nextItem.queueId));
          setProcessingIds(prev => {
            const next = new Set(prev);
            next.delete(nextItem.queueId);
            return next;
          });
        }
      });
    };

    processNext();
  }, [syncQueue, processingIds, summarizing, processItem, concurrency]);

  return { 
    syncQueue, 
    addToSyncQueue, 
    isProcessingQueue: processingIds.size > 0,
    setSyncQueue
  };
}
