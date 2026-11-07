import { wouldCreateCycle } from './dependency-graph';
import { describe, expect, it } from 'vitest';

describe('wouldCreateCycle', () => {
  it('allows a dependency with no return path', () => {
    expect(wouldCreateCycle([{ blockingTaskId: 'a', blockedTaskId: 'b' }], 'b', 'c')).toBe(false);
  });

  it('rejects a self dependency', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true);
  });

  it('rejects a direct reverse edge', () => {
    expect(wouldCreateCycle([{ blockingTaskId: 'a', blockedTaskId: 'b' }], 'b', 'a')).toBe(true);
  });

  it('detects cycles across a transitive chain', () => {
    const chain = [
      { blockingTaskId: 'a', blockedTaskId: 'b' },
      { blockingTaskId: 'b', blockedTaskId: 'c' },
      { blockingTaskId: 'c', blockedTaskId: 'd' },
    ];
    expect(wouldCreateCycle(chain, 'd', 'a')).toBe(true);
  });

  it('terminates on existing cycles and returns a safe result for unrelated tasks', () => {
    const malformed = [
      { blockingTaskId: 'a', blockedTaskId: 'b' },
      { blockingTaskId: 'b', blockedTaskId: 'a' },
    ];
    expect(wouldCreateCycle(malformed, 'x', 'y')).toBe(false);
  });
});
