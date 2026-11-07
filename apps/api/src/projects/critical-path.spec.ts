import { calculateCriticalPath } from './critical-path';
import { describe, expect, it } from 'vitest';

describe('calculateCriticalPath', () => {
  it('chooses the longest of independent dependency chains', () => {
    const tasks = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, status: 'TODO' }));
    const result = calculateCriticalPath(tasks, [
      { blockingTaskId: 'a', blockedTaskId: 'b' },
      { blockingTaskId: 'b', blockedTaskId: 'c' },
      { blockingTaskId: 'd', blockedTaskId: 'e' },
    ]);
    expect(result).toEqual({ cycleDetected: false, estimatedDays: 3, pathIds: ['a', 'b', 'c'] });
  });

  it('omits completed tasks from the remaining estimate, including completed predecessors', () => {
    const result = calculateCriticalPath([
      { id: 'done', status: 'DONE' },
      { id: 'active', status: 'IN_PROGRESS' },
      { id: 'next', status: 'TODO' },
    ], [
      { blockingTaskId: 'done', blockedTaskId: 'active' },
      { blockingTaskId: 'active', blockedTaskId: 'next' },
    ]);
    expect(result).toEqual({ cycleDetected: false, estimatedDays: 2, pathIds: ['active', 'next'] });
  });

  it('returns zero remaining days when all tasks are complete', () => {
    expect(calculateCriticalPath([{ id: 'done', status: 'DONE' }], [])).toEqual({ cycleDetected: false, estimatedDays: 0, pathIds: [] });
  });

  it('excludes cancelled work from the remaining path estimate', () => {
    const result = calculateCriticalPath([
      { id: 'cancelled', status: 'CANCELLED' },
      { id: 'active', status: 'TODO' },
    ], [{ blockingTaskId: 'cancelled', blockedTaskId: 'active' }]);
    expect(result).toEqual({ cycleDetected: false, estimatedDays: 1, pathIds: ['active'] });
  });

  it('reports a cycle in unfinished tasks', () => {
    const result = calculateCriticalPath([{ id: 'a', status: 'TODO' }, { id: 'b', status: 'TODO' }], [
      { blockingTaskId: 'a', blockedTaskId: 'b' },
      { blockingTaskId: 'b', blockedTaskId: 'a' },
    ]);
    expect(result).toEqual({ cycleDetected: true, estimatedDays: null, pathIds: [] });
  });
});
