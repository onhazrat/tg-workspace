import { describe, it, expect } from 'vitest';
import type { Channel } from '../types';
import { normalizeChannel } from './channelNormalize';

describe('normalizeChannel', () => {
  it('maps null startId from API to safe number (not null)', () => {
    const raw = {
      id: 'ch-1',
      name: 'ch-1',
      startId: null,
      startTime: null,
    } as unknown as Channel;
    expect(normalizeChannel(raw).startId).toBe(1);
  });

  it('maps null startId to undefined when startTime is set', () => {
    const raw = {
      id: 'ch-1',
      name: 'ch-1',
      startId: null,
      startTime: 1700000000000,
    } as unknown as Channel;
    expect(normalizeChannel(raw).startId).toBeUndefined();
  });

  it('keeps explicit startId', () => {
    const raw = { id: 'ch-1', name: 'ch-1', startId: 42 };
    expect(normalizeChannel(raw).startId).toBe(42);
  });

  it('defaults startId to 1 when neither startId nor startTime set', () => {
    const raw = { id: 'ch-1', name: 'ch-1' };
    expect(normalizeChannel(raw).startId).toBe(1);
  });

  it('coerces non-array tags to empty array', () => {
    const raw = { id: 'ch-1', name: 'ch-1', tags: null } as unknown as Channel;
    expect(normalizeChannel(raw).tags).toEqual([]);
  });
});
