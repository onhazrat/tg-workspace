import { openDB } from 'idb';
import { DB_VERSION } from '../lib/db';

const DB_NAME = 'TelegramSummarizerDB';
const CHUNK_SIZE = 500;

self.onmessage = async (e) => {
  const { type, fileHandle, metadata, useOPFS, file } = e.data;

  if (type === 'EXPORT') {
    try {
      let writable;
      let opfsFileHandle;

      if (useOPFS) {
        const root = await navigator.storage.getDirectory();
        opfsFileHandle = await root.getFileHandle('export.jsonl', { create: true });
        writable = await opfsFileHandle.createWritable();
      } else {
        writable = await fileHandle.createWritable();
      }

      const db = await openDB(DB_NAME, DB_VERSION);

      self.postMessage({ type: 'PROGRESS', message: 'Starting export...' });

      // Write metadata
      if (metadata) {
        await writable.write(JSON.stringify({ type: 'metadata', data: metadata }) + '\n');
      }

      let stores = e.data.selectedTables || [
        'channels', 'summaries', 'bot_credentials', 'chat_destinations',
        'publish_logs', 'sync_logs', 'llm_logs', 'embedding_logs', 'network_logs', 'posts', 'embeddings'
      ];

      if (e.data.excludePosts) {
        stores = stores.filter((s: string) => s !== 'posts');
        self.postMessage({ type: 'PROGRESS', message: 'Excluding posts from export...' });
      }

      for (const storeName of stores) {
        if (!db.objectStoreNames.contains(storeName)) continue;

        self.postMessage({ type: 'PROGRESS', message: `Exporting ${storeName}...` });

        let lastKey = undefined;
        let hasMore = true;
        let count = 0;

        while (hasMore) {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);

          let cursor = await store.openCursor(lastKey ? IDBKeyRange.lowerBound(lastKey, true) : undefined);
          let chunk = [];

          for (let i = 0; i < CHUNK_SIZE && cursor; i++) {
            chunk.push(cursor.value);
            lastKey = cursor.key;
            cursor = await cursor.continue();
          }

          if (chunk.length > 0) {
            for (const item of chunk) {
              const line = JSON.stringify({ type: 'store', storeName, data: item }) + '\n';
              await writable.write(line);
            }
            count += chunk.length;
            self.postMessage({ type: 'PROGRESS', message: `Exported ${count} records from ${storeName}...` });
          }

          if (chunk.length < CHUNK_SIZE) {
            hasMore = false;
          }
        }
      }

      await writable.close();

      if (useOPFS) {
        const opfsFile = await opfsFileHandle.getFile();
        self.postMessage({ type: 'SUCCESS', file: opfsFile });
      } else {
        self.postMessage({ type: 'SUCCESS' });
      }
    } catch (err: any) {
      self.postMessage({ type: 'ERROR', error: err.message });
    }
  } else if (type === 'IMPORT') {
    try {
      const stream = file.stream();
      const reader = stream.getReader();
      const decoder = new TextDecoder();

      const db = await openDB(DB_NAME, DB_VERSION);

      if (e.data.clear) {
        self.postMessage({ type: 'PROGRESS', message: 'Clearing existing database...' });
        const storesToClear = Array.from(db.objectStoreNames);
        if (storesToClear.length > 0) {
          const tx = db.transaction(storesToClear, 'readwrite');
          for (const storeName of storesToClear) {
            await tx.objectStore(storeName).clear();
          }
          await tx.done;
        }
      }

      let buffer = '';
      let records: any[] = [];
      let totalImported = 0;

      const processRecords = async (recordsToProcess: any[]) => {
        if (recordsToProcess.length === 0) return;

        const byStore: Record<string, any[]> = {};
        let meta = null;

        for (const record of recordsToProcess) {
          if (record.type === 'metadata') {
            meta = record.data;
          } else if (record.type === 'store') {
            if (!byStore[record.storeName]) byStore[record.storeName] = [];
            byStore[record.storeName].push(record.data);
          }
        }

        if (meta && meta.data && meta.data.localStorage) {
          self.postMessage({ type: 'METADATA', data: meta.data });
        }

        const storeNames = Object.keys(byStore);
        if (storeNames.length > 0) {
          // Filter out stores that don't exist in the current DB version
          const validStoreNames = storeNames.filter(name => db.objectStoreNames.contains(name));
          
          if (validStoreNames.length > 0) {
            const tx = db.transaction(validStoreNames, 'readwrite');
            for (const storeName of validStoreNames) {
              const store = tx.objectStore(storeName);
              for (const item of byStore[storeName]) {
                store.put(item);
              }
            }
            await tx.done;
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in the buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            records.push(JSON.parse(line));
          } catch (e) {
            console.error("Failed to parse line:", line);
          }
        }

        if (records.length >= CHUNK_SIZE) {
          await processRecords(records);
          totalImported += records.length;
          self.postMessage({ type: 'PROGRESS', message: `Imported ${totalImported} records...` });
          records = [];
        }
      }

      // Process remaining
      if (buffer.trim()) {
        try {
          records.push(JSON.parse(buffer));
        } catch (e) {
          console.error("Failed to parse line:", buffer);
        }
      }
      if (records.length > 0) {
        await processRecords(records);
        totalImported += records.length;
      }

      self.postMessage({ type: 'SUCCESS', message: `Imported ${totalImported} records successfully.` });
    } catch (err: any) {
      self.postMessage({ type: 'ERROR', error: err.message });
    }
  }
};
