# Route Optimization Specialist Skill

## Overview
Specialized skill for working with route optimization codebases, particularly those implementing the Chinese Postman Problem (CPP) algorithm for road network optimization.

## Core Competencies

### 1. Chinese Postman Problem (CPP) Algorithm
- **Eulerian Circuit Detection**: Identifying graphs with all even-degree vertices
- **Graph Augmentation**: Adding minimum-weight edges to make graphs Eulerian
- **Hierholzer's Algorithm**: Iterative implementation for finding Eulerian circuits
- **Semi-Eulerian Paths**: Handling graphs with exactly 2 odd-degree vertices

### 2. Graph Theory & NetworkX
- **Graph Representation**: MultiGraph and MultiDiGraph structures
- **Connectivity Analysis**: Connected components and strongly connected components
- **Degree Analysis**: Vertex degree calculation and odd-degree vertex identification
- **Shortest Path Algorithms**: Dijkstra's algorithm and variations

### 3. Route Optimization Techniques
- **Deadhead Minimization**: Reducing unnecessary travel between required edges
- **Turn Penalty Optimization**: Incorporating turn costs into route planning
- **Backtracking Detection**: Identifying and penalizing inefficient routing patterns
- **Component Handling**: Managing disconnected graph components

### 4. Geospatial Processing
- **GeoJSON Handling**: Parsing and processing geospatial road network data
- **Coordinate Systems**: Latitude/longitude handling and distance calculations
- **Haversine Formula**: Great-circle distance computation
- **Bounding Box Analysis**: Spatial extent verification

### 5. Algorithm Implementation
- **Iterative vs Recursive**: Avoiding recursion limits in large graphs
- **Edge Traversal Tracking**: Monitoring edge usage patterns
- **Revisit Detection**: Identifying multiple traversals of the same edge
- **Performance Optimization**: Efficient algorithms for large road networks

## Key Files & Components

### Primary Files
- `backend/app/optimize.py` - Core optimization algorithm
- `backend/app/hierholzer.py` - Eulerian circuit implementation
- `backend/app/routing_plugins.py` - Cost calculation plugins
- `backend/app/geojson_ops.py` - GeoJSON processing utilities

### Key Functions
- `_solve_cpp()` - Main CPP solver
- `_is_backtracking_edge()` - Backtracking detection
- `eulerian_circuit_nx()` - Hierholzer's algorithm implementation
- `_classify_turn()` - Turn classification for analytics

## Common Issues & Solutions

### 1. Euler Circuit Deadhead Distance
**Problem**: Euler circuits showing non-zero deadhead distance
**Solution**: Ensure backtracking detection only applies to revisited edges, not legitimate reverse traversals

### 2. Route Truncation
**Problem**: Final node missing from circuit routes
**Solution**: Verify route building logic preserves circuit closure

### 3. Backtracking False Positives
**Problem**: Legitimate edge traversals marked as backtracking
**Solution**: Add traversal count check before backtracking detection

### 4. Component Handling
**Problem**: Disconnected graph components not processed correctly
**Solution**: Implement component-wise CPP solving with proper concatenation

## Testing Strategies

### Unit Tests
- Triangle and ring graphs for Euler circuit verification
- T-shaped graphs for odd-degree vertex handling
- Disconnected components for multi-component processing

### Integration Tests
- Real GeoJSON data processing
- Turn penalty application verification
- Deadhead distance calculation validation

### Performance Tests
- Large graph processing
- Memory usage monitoring
- Execution time benchmarking

## Best Practices

### Code Quality
- **Consistent Thresholds**: Use same turn angle thresholds across modules
- **Clear Documentation**: Document algorithm assumptions and limitations
- **Comprehensive Logging**: Track algorithm decisions for debugging

### Algorithm Design
- **Iterative Approaches**: Prefer iteration over recursion for large graphs
- **Edge Canonicalization**: Use consistent edge representation for tracking
- **Traversal Counting**: Monitor edge usage patterns accurately

### Performance
- **Efficient Data Structures**: Use appropriate graph representations
- **Early Termination**: Exit early when possible
- **Caching**: Cache computed values where appropriate

## Debugging Techniques

### Common Debugging Tools
- **Route Visualization**: Plot routes to verify correctness
- **Traversal Logging**: Log edge traversal patterns
- **Graph Inspection**: Examine graph structure and properties

### Debugging Workflow
1. **Verify Input**: Check GeoJSON structure and graph construction
2. **Inspect Algorithm**: Trace through CPP solving steps
3. **Examine Output**: Validate route properties and statistics
4. **Compare Expected**: Contrast with theoretical expectations

## Domain Knowledge

### Road Network Characteristics
- **Undirected vs Directed**: Most road networks are undirected
- **Edge Properties**: Length, road class, turn restrictions
- **Connectivity Patterns**: Common road network topologies

### Optimization Metrics
- **Deadhead Distance**: Unnecessary travel between required edges
- **Turn Efficiency**: Minimizing costly turns
- **Route Efficiency**: Percentage of distance spent on required edges

### Algorithm Complexity
- **CPP Complexity**: O(E^3) for general case
- **Eulerian Circuit**: O(E) for existing Eulerian graphs
- **Memory Usage**: O(V + E) for graph storage

This skill provides comprehensive expertise for developing, maintaining, and debugging route optimization systems based on the Chinese Postman Problem algorithm.