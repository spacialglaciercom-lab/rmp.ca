# Edge-list format for Chinese Postman (cpp_hierholzer.py)

One edge per line:

```
u v
u v weight
```

- `u`, `v`: integer node IDs
- `weight`: optional; default 1.0
- Lines starting with `#` are comments; empty lines are skipped
- Graph is **undirected** (each line adds one edge in both directions)

## Example (Eulerian)

```
1 2 1
2 3 1
3 4 1
4 1 1
```

Run: `python cpp_hierholzer.py data/eulerian_edgelist.txt [start_node]`

## Example (non-Eulerian → CPP)

```
1 2 10
2 3 20
3 1 15
1 4 5
4 2 8
```

Run: `python cpp_hierholzer.py data/sample_edgelist.txt 1`
