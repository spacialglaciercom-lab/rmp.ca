# TrashRoute Optimization Algorithm

## Chinese Postman Problem (CPP)

TrashRoute uses a turn-aware variant of the Chinese Postman Problem to optimize trash collection routes. The goal is to find the shortest route that traverses every street (edge) at least once, returning to the starting point.

## Pipeline Steps

### 1. OSM Import (osmToStreetEdges)
Raw OpenStreetMap data is parsed into a graph of street edges. Each edge represents a street segment with properties like name, one-way status, and allowed vehicle types. The import handles both .osm and .pbf file formats.

### 2. Turn-Expanded Graph (buildTurnExpandedGraph)
The street graph is expanded into a turn-expanded graph where each node represents an (edge, direction) pair. Turn costs are added between consecutive edges based on the turn angle (straight, slight turn, sharp turn, U-turn). This ensures the solver accounts for the time cost of turns, which is significant for large trucks.

### 3. Strongly Connected Components (bridgeAllSCCs)
The graph must be strongly connected for an Eulerian circuit to exist. Kosaraju's algorithm identifies SCCs, and bridge edges are added between disconnected components using shortest-path connections. This step ensures every part of the service area is reachable.

### 4. Make Eulerian (makeEulerian)
For an Eulerian circuit to exist, every node must have equal in-degree and out-degree. The algorithm identifies imbalanced nodes and adds minimum-cost duplicate edges (deadheading) to balance the graph. This uses a minimum-weight matching approach.

### 5. Solve Turn-Aware CPP (solveTurnAwareCPP)
The final step finds an Eulerian circuit through the balanced graph. The solution minimizes total travel distance while respecting turn costs and one-way street constraints. The output is an ordered sequence of street edges forming the optimal route.

## Vehicle Constraints

### Mechanical Arm Trucks
- Must service addresses on the RIGHT side of the vehicle
- Prefer routes that keep the curb on the driver's right
- Cannot service both sides of a street in one pass on divided roads
- Turning radius approximately 12 meters

### Vacuum Trucks
- Can service both sides of the street
- More flexible routing but still prefer to minimize U-turns
- Used for leaf collection and street sweeping

## Route Optimization Features

### Weather-Optimized Routing
When enabled, the system fetches current weather data and adjusts route costs:
- Rain/snow increases travel time estimates
- Extreme cold affects vehicle performance
- Wind direction can impact collection efficiency

### Learned Penalties
Historical route data is used to learn time penalties for specific streets or intersections. Streets that consistently take longer than estimated receive higher costs in future optimizations.

### Turn Cost Categories
- Straight: 0s penalty
- Slight turn (< 45 degrees): 5s penalty
- Regular turn (45-135 degrees): 15s penalty
- Sharp turn (> 135 degrees): 25s penalty
- U-turn (> 160 degrees): 45s penalty
