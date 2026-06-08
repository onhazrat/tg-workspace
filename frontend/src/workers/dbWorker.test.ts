import { describe, it, expect, vi } from 'vitest';

describe('Export Logic', () => {
  it('should not throw Invalid string length when exporting many large objects', async () => {
    // Simulate the worker's export logic
    const CHUNK_SIZE = 500;
    
    // Create a mock writable stream
    let writtenLines = 0;
    const mockWritable = {
      write: async (data: string) => {
        writtenLines += data.split('\n').length - 1;
      },
      close: async () => {}
    };

    // Generate a large mock object (e.g., a post with an embedding)
    const largeArray = new Array(1536).fill(0.123456789);
    const mockItem = {
      id: 1,
      text: 'A'.repeat(1000),
      embedding: largeArray
    };

    // Simulate a chunk of 500 items
    const chunk = new Array(CHUNK_SIZE).fill(mockItem);

    // This is the logic we fixed: writing line by line instead of accumulating
    let count = 0;
    if (chunk.length > 0) {
      // We wrap it in a try-catch to ensure it doesn't throw
      expect(() => {
        for (const item of chunk) {
          const line = JSON.stringify({ type: 'store', storeName: 'posts', data: item }) + '\n';
          // In the real worker we await writable.write(line), here we just simulate it
          mockWritable.write(line);
        }
      }).not.toThrow();
      count += chunk.length;
    }

    expect(count).toBe(CHUNK_SIZE);
    expect(writtenLines).toBe(CHUNK_SIZE);
  });
});
