export type DependencyEdge = { blockingTaskId: string; blockedTaskId: string };

/** Returns true when adding blocker -> blocked would close a directed cycle. */
export function wouldCreateCycle(edges: DependencyEdge[], blockerId: string, blockedId: string): boolean {
  if (blockerId === blockedId) return true;
  const graph = new Map<string, string[]>();
  for (const edge of edges) graph.set(edge.blockingTaskId, [...(graph.get(edge.blockingTaskId) ?? []), edge.blockedTaskId]);
  const stack = [blockedId];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === blockerId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(graph.get(current) ?? []));
  }
  return false;
}
