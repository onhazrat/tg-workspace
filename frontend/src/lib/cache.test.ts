import { describe, it, expect } from 'vitest';
import { exportDBMetadata } from './cache';

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
    expect((metadata.data as Record<string, unknown>).channels).toBeUndefined();
    expect((metadata.data as Record<string, unknown>).summaries).toBeUndefined();
    expect((metadata.data as Record<string, unknown>).embedding_logs).toBeUndefined();
  });
});
