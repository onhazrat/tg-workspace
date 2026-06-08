import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const mockApi = {
  syncMeta: vi.fn(),
  upsertChannel: vi.fn(),
  listChannels: vi.fn(),
};

const mockCache = {
  saveChannel: vi.fn(),
  getChannels: vi.fn().mockResolvedValue([]),
};

vi.mock('@/api', () => ({
  api: mockApi,
}));

vi.mock('./cache', () => mockCache);

describe('repository apiWrite fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    mockApi.syncMeta.mockResolvedValue({ channels: { etag: 'remote-etag' } });
    mockApi.upsertChannel.mockRejectedValue(new Error('network error'));
    mockCache.saveChannel.mockResolvedValue(undefined);
    localStorage.clear();
  });

  it('calls onWriteFallback when API write fails', async () => {
    const { setWriteFallbackHandler, upsertChannel } = await import('./repository');
    const fallback = vi.fn();
    setWriteFallbackHandler(fallback);

    const channel = {
      id: 'ch-1',
      name: 'testchannel',
      lastUpdated: Date.now(),
    };

    await expect(upsertChannel(channel)).rejects.toThrow('network error');
    expect(mockCache.saveChannel).toHaveBeenCalledWith(channel);
    expect(fallback).toHaveBeenCalledWith('channels', expect.any(Error));
  });
});
