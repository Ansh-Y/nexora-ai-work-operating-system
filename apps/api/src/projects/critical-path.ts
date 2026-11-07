import { DependencyEdge } from '../tasks/dependency-graph';

export type CriticalPathTask = { id: string; status: string };

/** Remaining path estimate: each unfinished task is one workday; completed tasks take no remaining time. */
export function calculateCriticalPath(tasks: CriticalPathTask[], edges: DependencyEdge[]) {
  const active = tasks.filter(task => task.status !== 'DONE' && task.status !== 'CANCELLED');
  if (!active.length) return { cycleDetected: false, estimatedDays: 0, pathIds: [] as string[] };

  const ids = new Set(active.map(task => task.id));
  const relevantEdges = edges.filter(edge => ids.has(edge.blockingTaskId) && ids.has(edge.blockedTaskId));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(active.map(task => [task.id, 0]));
  for (const edge of relevantEdges) {
    outgoing.set(edge.blockingTaskId, [...(outgoing.get(edge.blockingTaskId) ?? []), edge.blockedTaskId]);
    indegree.set(edge.blockedTaskId, (indegree.get(edge.blockedTaskId) ?? 0) + 1);
  }

  const queue = active.map(task => task.id).filter(id => indegree.get(id) === 0);
  const order: string[] = [];
  const days = new Map(active.map(task => [task.id, 1]));
  const previous = new Map<string, string>();
  while (queue.length) {
    const current = queue.shift()!;
    order.push(current);
    for (const next of outgoing.get(current) ?? []) {
      if ((days.get(current) ?? 1) + 1 > (days.get(next) ?? 1)) {
        days.set(next, (days.get(current) ?? 1) + 1);
        previous.set(next, current);
      }
      indegree.set(next, (indegree.get(next) ?? 1) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }

  if (order.length !== active.length) return { cycleDetected: true, estimatedDays: null, pathIds: [] as string[] };
  let tail = order.reduce((best, id) => (days.get(id) ?? 0) > (days.get(best) ?? 0) ? id : best, order[0]);
  const pathIds = [tail];
  while (previous.has(tail)) {
    tail = previous.get(tail)!;
    pathIds.unshift(tail);
  }
  return { cycleDetected: false, estimatedDays: pathIds.length, pathIds };
}
