"""
Iterative Hierholzer's algorithm for Eulerian circuit on a NetworkX MultiGraph.

Drop-in replacement for nx.eulerian_circuit that avoids Python recursion limits
on large road graphs. O(V + E) time and space.
"""

from __future__ import annotations

import collections
from typing import Any

import networkx as nx


def eulerian_circuit_nx(
    G: nx.MultiGraph | nx.MultiDiGraph,
    start: Any = None,
) -> list[tuple[Any, Any]]:
    """
    Find an Eulerian circuit on *G* using iterative Hierholzer.

    G must already be Eulerian (every vertex even-degree, graph connected).
    Returns a list of (u, v) edge tuples identical in shape to nx.eulerian_circuit.
    Raises nx.NetworkXError if G has no nodes.
    """
    if G.number_of_nodes() == 0:
        raise nx.NetworkXError("graph has no nodes")

    is_directed = G.is_directed()

    if start is None:
        start = next(iter(G.nodes()))

    # Build mutable adjacency: node -> deque of (neighbor, edge_key)
    # For undirected each undirected edge (u,v,k) is added to both u and v.
    adj: dict[Any, collections.deque[tuple[Any, int]]] = {
        u: collections.deque() for u in G.nodes()
    }
    for u, v, k in G.edges(keys=True):
        adj[u].append((v, k))
        if not is_directed and u != v:
            adj[v].append((u, k))

    # Canonical key for an undirected edge to detect already-used edges
    used: set[tuple[Any, Any, int]] = set()

    stack: list[Any] = [start]
    circuit_nodes: list[Any] = []

    # Track visited states to prevent infinite loops
    # State = (current_node, frozenset_of_used_edges)
    visited_states: set[tuple[Any, frozenset[tuple[Any, Any, int]]]] = set()

    while stack:
        u = stack[-1]
        
        # Create state key for cycle detection
        state_key = (u, frozenset(used))
        if state_key in visited_states:
            # We've been in this exact state before - break potential infinite loop
            circuit_nodes.append(stack.pop())
            continue
        visited_states.add(state_key)

        advanced = False
        while adj[u]:
            v, k = adj[u][-1]
            canon = (u, v, k) if is_directed else (min(u, v), max(u, v), k)
            adj[u].pop()
            if canon in used:
                continue
            used.add(canon)
            stack.append(v)
            advanced = True
            break
        if not advanced:
            circuit_nodes.append(stack.pop())

    circuit_nodes.reverse()

    # Convert node sequence -> edge list [(u, v), ...]
    return list(zip(circuit_nodes, circuit_nodes[1:]))
