import { describe, it, expect, vi } from 'vitest';
import { exportDBMetadata } from './db';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] || null,
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
});

describe('exportDBMetadata', () => {
  it('should only export localStorage and not load all stores into memory', async () => {
    localStorage.setItem('testKey', 'testValue');
    
    const metadata = await exportDBMetadata();
    
    expect(metadata.data.localStorage).toEqual({ testKey: 'testValue' });
    
    // Ensure it doesn't contain the huge arrays that would cause OOM
    expect((metadata.data as any).channels).toBeUndefined();
    expect((metadata.data as any).summaries).toBeUndefined();
    expect((metadata.data as any).embedding_logs).toBeUndefined();
  });
});
