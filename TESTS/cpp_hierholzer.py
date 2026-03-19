#!/usr/bin/env python3
"""
Chinese Postman Problem (CPP) via edge-list parser + Hierholzer's algorithm.

- Parses undirected graphs from edge-list files (u v [weight] per line).
- Uses Hierholzer's algorithm to find an Eulerian circuit when the graph is Eulerian.
- For non-Eulerian graphs, makes the graph Eulerian by duplicating a minimum-cost
  set of edges (min-cost perfect matching on odd-degree vertices), then runs Hierholzer.

Uses only: collections, heapq, itertools (for matching), re, sys, os.
"""

from __future__ import annotations

import heapq
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# 1. Edge-list parser
# ---------------------------------------------------------------------------


@dataclass
class EdgeListGraph:
    """Undirected graph from an edge list. Supports multi-edges (duplicate edges)."""

    # Node id -> list of (neighbor, weight); each edge appears in both endpoints.
    adj: Dict[int, List[Tuple[int, float]]] = field(default_factory=lambda: defaultdict(list))
    # Set of all node ids (so we don't miss isolated nodes if header says so).
    nodes: set = field(default_factory=set)
    # Total number of edges (counting multiplicity) as parsed.
    num_edges: int = 0

    def add_edge(self, u: int, v: int, weight: float = 1.0) -> None:
        self.nodes.add(u)
        self.nodes.add(v)
        self.adj[u].append((v, weight))
        self.adj[v].append((u, weight))
        self.num_edges += 1

    def degree(self, u: int) -> int:
        return len(self.adj[u])

    def is_eulerian(self) -> bool:
        """True if every vertex has even degree (undirected Eulerian)."""
        return all(self.degree(u) % 2 == 0 for u in self.nodes)

    def odd_degree_vertices(self) -> List[int]:
        return [u for u in sorted(self.nodes) if self.degree(u) % 2 != 0]


def parse_edge_list(
    filepath: str,
    weight_default: float = 1.0,
    comment_char: str = "#",
) -> EdgeListGraph:
    """
    Parse an edge-list file into an undirected graph.

    Format (one per line):
      u v
      u v weight
    Lines starting with comment_char are ignored. Empty lines skipped.
    Optional first line: "nodes n" or "n m" (number of nodes, number of edges) for validation only.
    Node ids can be integers; they are converted with int().

    Returns EdgeListGraph. Raises on invalid file or duplicate-edge handling issues.
    """
    if not os.path.isfile(filepath):
        raise FileNotFoundError(f"Edge-list file not found: {filepath}")

    g = EdgeListGraph()
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith(comment_char):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            try:
                u, v = int(parts[0]), int(parts[1])
                w = float(parts[2]) if len(parts) > 2 else weight_default
            except ValueError:
                continue
            if u == v:
                continue  # skip self-loops for simplicity
            g.add_edge(u, v, w)
    return g


# ---------------------------------------------------------------------------
# 2. Hierholzer's algorithm (Eulerian circuit)
# ---------------------------------------------------------------------------


def _copy_adjacency(g: EdgeListGraph) -> Dict[int, List[Tuple[int, float]]]:
    """Deep copy of g.adj so we can mutate during traversal."""
    return {u: list(g.adj[u]) for u in g.nodes}


def hierholzer(
    g: EdgeListGraph,
    start: Optional[int] = None,
) -> List[int]:
    """
    Find an Eulerian circuit (closed walk that uses every edge exactly once).

    g must be Eulerian (all even degree). Returns a list of vertices in order
    (first and last will be equal for a circuit). If start is None, uses the
    first node (by id) that has positive degree.
    """
    if not g.nodes:
        return []
    if not g.is_eulerian():
        raise ValueError("Graph is not Eulerian (not all vertices have even degree).")

    adj = _copy_adjacency(g)
    start = start or min(u for u in g.nodes if adj[u])
    circuit: List[int] = []

    def find_subtour(from_v: int) -> List[int]:
        sub = [from_v]
        cur = from_v
        while adj[cur]:
            # Remove first edge (cur, next) and the corresponding (next, cur).
            next_v, _ = adj[cur].pop(0)
            # Remove the reverse edge from next_v's list.
            for i, (w, _) in enumerate(adj[next_v]):
                if w == cur:
                    adj[next_v].pop(i)
                    break
            cur = next_v
            sub.append(cur)
        return sub

    stack = [start]
    while stack:
        v = stack[-1]
        if not adj[v]:
            circuit.append(v)
            stack.pop()
        else:
            subtour = find_subtour(v)
            # subtour[0] == v, subtour[-1] == v (we return to v)
            # Splice: replace v on stack with the subtour (excluding final v).
            stack.pop()
            # Insert subtour[:-1] in reverse so that when we pop, order is correct.
            for i in range(len(subtour) - 2, -1, -1):
                stack.append(subtour[i])

    circuit = circuit[::-1]
    # Close the circuit: last vertex must equal start (Eulerian circuit returns to start).
    if circuit and circuit[-1] != circuit[0]:
        circuit.append(circuit[0])
    # Rotate so circuit starts and ends at start vertex (for consistent output).
    if start is not None and circuit and circuit[0] != start:
        for i in range(len(circuit)):
            if circuit[i] == start:
                circuit = circuit[i:] + circuit[1:i] + [start]
                break
    return circuit


# ---------------------------------------------------------------------------
# 3. Chinese Postman: make Eulerian then Hierholzer
# ---------------------------------------------------------------------------


def _all_pairs_shortest_paths(g: EdgeListGraph) -> Dict[Tuple[int, int], float]:
    """Floyd-Warshall; returns dist[u,v] for all u,v in g.nodes."""
    nodes = sorted(g.nodes)
    n = len(nodes)
    idx = {v: i for i, v in enumerate(nodes)}
    INF = float("inf")
    dist = [[INF] * n for _ in range(n)]
    for i in range(n):
        dist[i][i] = 0
    for u in g.nodes:
        for v, w in g.adj[u]:
            if u < v:  # each edge once
                i, j = idx[u], idx[v]
                dist[i][j] = dist[j][i] = min(dist[i][j], w)
    for k in range(n):
        for i in range(n):
            for j in range(n):
                if dist[i][k] + dist[k][j] < dist[i][j]:
                    dist[i][j] = dist[i][k] + dist[k][j]
    return {(nodes[i], nodes[j]): dist[i][j] for i in range(n) for j in range(n)}


def _min_cost_perfect_matching_greedy(
    odd_nodes: List[int],
    dist: Dict[Tuple[int, int], float],
) -> List[Tuple[int, int]]:
    """
    Greedy min-cost perfect matching on odd_nodes: repeatedly pair the two nodes
    with smallest distance. Not optimal but simple and good for small instances.
    """
    if len(odd_nodes) % 2 != 0:
        raise ValueError("Odd number of odd-degree vertices (invalid graph).")
    remaining = set(odd_nodes)
    matching: List[Tuple[int, int]] = []
    while remaining:
        best_pair = None
        best_dist = float("inf")
        for u in remaining:
            for v in remaining:
                if u >= v:
                    continue
                d = dist.get((u, v), dist.get((v, u), float("inf")))
                if d < best_dist:
                    best_dist = d
                    best_pair = (u, v)
        if best_pair is None:
            break
        u, v = best_pair
        matching.append((u, v))
        remaining.discard(u)
        remaining.discard(v)
    return matching


def _shortest_path_edges(g: EdgeListGraph, dist: Dict[Tuple[int, int], float], u: int, v: int) -> List[Tuple[int, int, float]]:
    """
    Reconstruct a shortest path from u to v using Dijkstra; return list of
    (a, b, weight) for each edge on the path.
    """
    INF = float("inf")
    d = {n: INF for n in g.nodes}
    d[u] = 0
    prev: Dict[int, Optional[int]] = {n: None for n in g.nodes}
    heap: List[Tuple[float, int]] = [(0, u)]
    while heap:
        du, cur = heapq.heappop(heap)
        if du > d[cur]:
            continue
        if cur == v:
            break
        for w, weight in g.adj[cur]:
            if d[w] > d[cur] + weight:
                d[w] = d[cur] + weight
                prev[w] = cur
                heapq.heappush(heap, (d[w], w))
    path_edges: List[Tuple[int, int, float]] = []
    cur = v
    while prev[cur] is not None:
        p = prev[cur]
        for w, weight in g.adj[p]:
            if w == cur:
                path_edges.append((p, cur, weight))
                break
        cur = p
    return path_edges[::-1]


def chinese_postman(g: EdgeListGraph, start: Optional[int] = None) -> Tuple[List[int], float]:
    """
    Solve the Chinese Postman Problem: closed walk that traverses every edge at least once.

    If g is Eulerian, returns (Eulerian circuit, total cost).
    Otherwise duplicates a minimum-cost set of edges (via greedy matching on odd-degree
    nodes), then runs Hierholzer on the augmented graph. Total cost = sum of all
    edge weights in the walk (each edge counted per traversal).
    """
    if not g.nodes:
        return [], 0.0

    if g.is_eulerian():
        circuit = hierholzer(g, start=start)
        # Total cost = sum of all edge weights (each edge once).
        total = sum(w for u in g.nodes for _, w in g.adj[u]) // 2
        return circuit, total

    odd = g.odd_degree_vertices()
    if len(odd) % 2 != 0:
        raise ValueError("Graph has odd number of odd-degree vertices.")

    dist = _all_pairs_shortest_paths(g)
    matching = _min_cost_perfect_matching_greedy(odd, dist)

    # Build augmented graph: g plus duplicate edges along shortest paths for each pair.
    aug = EdgeListGraph()
    for u in g.nodes:
        for v, w in g.adj[u]:
            if u < v:
                aug.add_edge(u, v, w)

    for u, v in matching:
        path_edges = _shortest_path_edges(g, dist, u, v)
        for a, b, w in path_edges:
            aug.add_edge(a, b, w)

    circuit = hierholzer(aug, start=start or min(g.nodes))
    total = sum(w for u in aug.nodes for _, w in aug.adj[u]) // 2
    return circuit, total


# ---------------------------------------------------------------------------
# 4. CLI and reporting
# ---------------------------------------------------------------------------


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python cpp_hierholzer.py <edge_list_file> [start_node]")
        print("  edge_list_file: path to file with lines 'u v [weight]'")
        print("  start_node: optional first vertex in the circuit")
        sys.exit(1)

    path = sys.argv[1]
    start = int(sys.argv[2]) if len(sys.argv) > 2 else None

    try:
        g = parse_edge_list(path)
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        sys.exit(1)

    print(f"Graph: {len(g.nodes)} nodes, {g.num_edges} edges")
    if not g.nodes:
        print("Empty graph.")
        sys.exit(0)

    if g.is_eulerian():
        print("Graph is Eulerian.")
        try:
            circuit = hierholzer(g, start=start)
            # Total cost = sum of all edge weights (each edge traversed exactly once).
            cost = sum(w for u in g.nodes for _, w in g.adj[u]) / 2
            print(f"Eulerian circuit length: {len(circuit)} vertices, total cost: {cost}")
            print("Circuit (first 50 vertices):", circuit[:50])
            if len(circuit) > 50:
                print("  ...")
        except ValueError as e:
            print(e, file=sys.stderr)
            sys.exit(1)
    else:
        odd = g.odd_degree_vertices()
        print(f"Graph is not Eulerian. Odd-degree vertices ({len(odd)}): {odd}")
        try:
            circuit, cost = chinese_postman(g, start=start)
            print(f"Chinese Postman circuit: {len(circuit)} vertices, total cost: {cost}")
            print("Circuit (first 50 vertices):", circuit[:50])
            if len(circuit) > 50:
                print("  ...")
        except ValueError as e:
            print(e, file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
