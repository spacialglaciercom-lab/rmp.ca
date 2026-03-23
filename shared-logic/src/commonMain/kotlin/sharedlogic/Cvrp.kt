package sharedlogic

/**
 * CVRP solver with Clarke-Wright Savings + 2-opt improvement.
 * 
 * This is a full implementation ported from lib/vrp-solvers/clarke-wright.ts
 * and lib/vrp-solvers/two-opt.ts for Kotlin Multiplatform.
 * 
 * Algorithm:
 * 1. Clarke-Wright Savings: Merge routes based on distance savings
 * 2. 2-opt improvement: Local search to improve each route
 * 3. Balanced distribution: Spread stops evenly across vehicles
 */

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.sqrt

// ---------------------------------------------------------------------------
// Data classes
// ---------------------------------------------------------------------------

/**
 * A location in the CVRP problem.
 */
data class CvrpLocation(
    val lat: Double,
    val lon: Double,
    val label: String,
    val demand: Double = 0.0,
    val serviceTimeMinutes: Double = 5.0,
)

/**
 * A cell in the distance/time matrix.
 */
data class CvrpMatrixCell(
    val distance: Double,  // in meters
    val time: Double,      // in seconds
)

/**
 * Result of the CVRP solver.
 */
data class CvrpResult(
    val stops: List<CvrpLocation>,
    val routes: List<List<CvrpLocation>>,
    val routeIndices: List<List<Int>>,
    val totalDistanceKm: String,
    val totalTimeMin: Int,
    val totalDistanceMeters: Double,
    val totalTimeSeconds: Double,
)

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

private fun formatKm(meters: Double): String {
    val km = meters / 1000.0
    val intPart = km.toLong()
    val frac = ((km - intPart) * 100).toInt().coerceIn(0, 99)
    return "$intPart.${frac.toString().padStart(2, '0')}"
}

private fun haversineDistance(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val R = 6371000.0 // Earth radius in meters
    val dLat = Math.toRadians(lat2 - lat1)
    val dLon = Math.toRadians(lon2 - lon1)
    val a = kotlin.math.sin(dLat / 2).let { it * it } +
            kotlin.math.cos(Math.toRadians(lat1)) * 
            kotlin.math.cos(Math.toRadians(lat2)) * 
            kotlin.math.sin(dLon / 2).let { it * it }
    val c = 2 * kotlin.math.atan2(sqrt(a), sqrt(1 - a))
    return R * c
}

// ---------------------------------------------------------------------------
// Clarke-Wright Savings Algorithm
// ---------------------------------------------------------------------------

/**
 * Savings entry for Clarke-Wright algorithm.
 */
private data class SavingsEntry(
    val i: Int,
    val j: Int,
    val savings: Double,
)

/**
 * Solve CVRP using Clarke-Wright Savings algorithm with balanced distribution.
 * 
 * @param locations List of locations (depot at index 0)
 * @param numVehicles Number of vehicles available
 * @param matrix Distance/time matrix
 * @return CvrpResult with routes and totals
 */
fun solveCvrp(
    locations: List<CvrpLocation>,
    numVehicles: Int,
    matrix: List<List<CvrpMatrixCell>>,
): CvrpResult {
    if (locations.isEmpty()) {
        return CvrpResult(
            stops = emptyList(),
            routes = emptyList(),
            routeIndices = emptyList(),
            totalDistanceKm = "0.00",
            totalTimeMin = 0,
            totalDistanceMeters = 0.0,
            totalTimeSeconds = 0.0,
        )
    }
    
    if (locations.size == 1) {
        return CvrpResult(
            stops = locations,
            routes = listOf(locations),
            routeIndices = listOf(listOf(0)),
            totalDistanceKm = "0.00",
            totalTimeMin = 0,
            totalDistanceMeters = 0.0,
            totalTimeSeconds = 0.0,
        )
    }
    
    val n = matrix.size
    
    // Helper to get distance from matrix
    fun d(i: Int, j: Int): Double = matrix.getOrNull(i)?.getOrNull(j)?.distance ?: 0.0
    fun t(i: Int, j: Int): Double = matrix.getOrNull(i)?.getOrNull(j)?.time ?: 0.0
    
    // Calculate savings: s(i,j) = d(0,i) + d(0,j) - d(i,j)
    val savings = mutableListOf<SavingsEntry>()
    for (i in 1 until n) {
        for (j in i + 1 until n) {
            val s = d(0, i) + d(0, j) - d(i, j)
            if (s > 0) {
                savings.add(SavingsEntry(i, j, s))
            }
        }
    }
    savings.sortByDescending { it.savings }
    
    // Initialize: each location is its own route (depot -> location -> depot)
    val routes = mutableListOf<MutableList<Int>>()
    for (i in 1 until n) {
        routes.add(mutableListOf(0, i, 0))
    }
    
    // Maximum intermediate stops per route for balanced distribution
    val maxIntermediateStops = kotlin.math.ceil((n - 1).toDouble() / numVehicles).toInt()
    val cap = maxIntermediateStops + 1
    
    // Helper to find route containing a node
    fun findRoute(node: Int): Int = routes.indexOfFirst { it.contains(node) }
    
    // Helper to count intermediate stops
    fun intermediateCount(route: List<Int>): Int = kotlin.math.max(0, route.size - 2)
    
    // Merge routes based on savings
    for ((i, j, _) in savings) {
        if (routes.size <= numVehicles) break
        
        val ri = findRoute(i)
        val rj = findRoute(j)
        if (ri < 0 || rj < 0 || ri == rj) continue
        
        val ra = routes[ri].toList()
        val rb = routes[rj].toList()
        
        val endOfA = ra[ra.size - 2]
        val startOfB = rb[1]
        
        val merged: List<Int>? = when {
            endOfA == i && startOfB == j -> ra.dropLast(1) + rb.drop(1)
            endOfA == j && startOfB == i -> ra.dropLast(1) + rb.drop(1)
            else -> {
                val raRev = ra.reversed()
                val rbRev = rb.reversed()
                when {
                    raRev[raRev.size - 2] == i && rbRev[1] == j -> raRev.dropLast(1) + rbRev.drop(1)
                    raRev[raRev.size - 2] == j && rbRev[1] == i -> raRev.dropLast(1) + rbRev.drop(1)
                    else -> null
                }
            }
        }
        
        if (merged != null && intermediateCount(merged) <= cap) {
            // Remove old routes and add merged
            val toRemove = sortedSetOf(ri, rj).sortedDescending()
            for (idx in toRemove) {
                routes.removeAt(idx)
            }
            routes.add(merged.toMutableList())
        }
    }
    
    // Force merge remaining routes if still too many
    while (routes.size > numVehicles) {
        var bestI = 0
        var bestJ = 1
        var bestMerged: List<Int>? = null
        var bestCost = Double.MAX_VALUE
        
        for (i in routes.indices) {
            for (j in i + 1 until routes.size) {
                val ra = routes[i]
                val rb = routes[j]
                
                val candidates = listOf(
                    ra.dropLast(1) + rb.drop(1),
                    ra.dropLast(1) + rb.drop(1).dropLast(1).reversed() + listOf(0),
                    listOf(0) + ra.drop(1).dropLast(1).reversed() + rb.drop(1),
                    listOf(0) + rb.drop(1).dropLast(1).reversed() + ra.drop(1),
                )
                
                for (merged in candidates) {
                    if (merged.size < 3) continue
                    var cost = 0.0
                    for (k in 0 until merged.size - 1) {
                        cost += d(merged[k], merged[k + 1])
                    }
                    if (cost < bestCost) {
                        bestCost = cost
                        bestI = i
                        bestJ = j
                        bestMerged = merged
                    }
                }
            }
        }
        
        if (bestMerged == null) break
        
        val toRemove = sortedSetOf(bestI, bestJ).sortedDescending()
        for (idx in toRemove) {
            routes.removeAt(idx)
        }
        routes.add(bestMerged.toMutableList())
    }
    
    // Apply 2-opt improvement to each route
    for (ri in routes.indices) {
        routes[ri] = twoOptImprove(routes[ri], ::d).toMutableList()
    }
    
    // Calculate totals
    var totalDistance = 0.0
    var totalTime = 0.0
    
    for (route in routes) {
        for (k in 0 until route.size - 1) {
            totalDistance += d(route[k], route[k + 1])
            totalTime += t(route[k], route[k + 1])
        }
    }
    
    // Build result
    val routeLocations = routes.map { route -> 
        route.map { idx -> locations.getOrElse(idx) { locations[0] } }
    }
    
    return CvrpResult(
        stops = locations,
        routes = routeLocations,
        routeIndices = routes.map { it.toList() },
        totalDistanceKm = formatKm(totalDistance),
        totalTimeMin = (totalTime / 60.0).toInt(),
        totalDistanceMeters = totalDistance,
        totalTimeSeconds = totalTime,
    )
}

// ---------------------------------------------------------------------------
// 2-Opt Improvement
// ---------------------------------------------------------------------------

/**
 * Improve a route using 2-opt local search.
 * 
 * @param route The route to improve (list of node indices)
 * @param distance Function to get distance between two nodes
 * @return Improved route
 */
private fun twoOptImprove(
    route: List<Int>,
    distance: (Int, Int) -> Double,
): List<Int> {
    if (route.size <= 3) return route
    
    val improved = route.toMutableList()
    var changed = true
    
    while (changed) {
        changed = false
        for (i in 1 until improved.size - 2) {
            for (k in i + 1 until improved.size - 1) {
                val delta = 
                    distance(improved[i - 1], improved[k]) +
                    distance(improved[i], improved[k + 1]) -
                    distance(improved[i - 1], improved[i]) -
                    distance(improved[k], improved[k + 1])
                
                if (delta < -1e-9) {
                    // Reverse the segment between i and k
                    var lo = i
                    var hi = k
                    while (lo < hi) {
                        val tmp = improved[lo]
                        improved[lo] = improved[hi]
                        improved[hi] = tmp
                        lo++
                        hi--
                    }
                    changed = true
                }
            }
        }
    }
    
    return improved.toList()
}

// ---------------------------------------------------------------------------
// Sweep Algorithm (Alternative)
// ---------------------------------------------------------------------------

/**
 * Solve CVRP using Sweep algorithm + 2-opt.
 * 
 * This is an alternative to Clarke-Wright that uses angular clustering.
 * 
 * @param locations List of locations (depot at index 0)
 * @param numVehicles Number of vehicles available
 * @param matrix Distance/time matrix
 * @return CvrpResult with routes and totals
 */
fun solveCvrpSweep(
    locations: List<CvrpLocation>,
    numVehicles: Int,
    matrix: List<List<CvrpMatrixCell>>,
): CvrpResult {
    if (locations.isEmpty()) {
        return CvrpResult(
            stops = emptyList(),
            routes = emptyList(),
            routeIndices = emptyList(),
            totalDistanceKm = "0.00",
            totalTimeMin = 0,
            totalDistanceMeters = 0.0,
            totalTimeSeconds = 0.0,
        )
    }
    
    val n = matrix.size
    if (n <= 1) {
        return CvrpResult(
            stops = locations,
            routes = listOf(locations),
            routeIndices = listOf(listOf(0)),
            totalDistanceKm = "0.00",
            totalTimeMin = 0,
            totalDistanceMeters = 0.0,
            totalTimeSeconds = 0.0,
        )
    }
    
    fun d(i: Int, j: Int): Double = matrix.getOrNull(i)?.getOrNull(j)?.distance ?: 0.0
    fun t(i: Int, j: Int): Double = matrix.getOrNull(i)?.getOrNull(j)?.time ?: 0.0
    
    // Sort stops by angle from depot
    val depot = locations[0]
    val stopIndices = (1 until n).toList().sortedBy { i ->
        val loc = locations[i]
        atan2(loc.lat - depot.lat, loc.lon - depot.lon)
    }
    
    // Distribute stops across vehicles
    val perRoute = kotlin.math.ceil(stopIndices.size.toDouble() / numVehicles).toInt()
    val routes = mutableListOf<MutableList<Int>>()
    
    for (v in 0 until numVehicles) {
        val segment = stopIndices.drop(v * perRoute).take(perRoute)
        if (segment.isEmpty()) continue
        
        // Nearest neighbor construction within segment
        val route = mutableListOf(0)
        val remaining = segment.toMutableSet()
        var current = 0
        
        while (remaining.isNotEmpty()) {
            var best = -1
            var bestDist = Double.MAX_VALUE
            for (node in remaining) {
                val dist = d(current, node)
                if (dist < bestDist) {
                    bestDist = dist
                    best = node
                }
            }
            if (best < 0) break
            remaining.remove(best)
            route.add(best)
            current = best
        }
        route.add(0)
        routes.add(route)
    }
    
    // Apply 2-opt improvement to each route
    for (ri in routes.indices) {
        val improved = twoOptImprove(routes[ri], ::d)
        routes[ri] = improved.toMutableList()
    }
    
    // Calculate totals
    var totalDistance = 0.0
    var totalTime = 0.0
    
    for (route in routes) {
        for (k in 0 until route.size - 1) {
            totalDistance += d(route[k], route[k + 1])
            totalTime += t(route[k], route[k + 1])
        }
    }
    
    // Build result
    val routeLocations = routes.map { route -> 
        route.map { idx -> locations.getOrElse(idx) { locations[0] } }
    }
    
    return CvrpResult(
        stops = locations,
        routes = routeLocations,
        routeIndices = routes.map { it.toList() },
        totalDistanceKm = formatKm(totalDistance),
        totalTimeMin = (totalTime / 60.0).toInt(),
        totalDistanceMeters = totalDistance,
        totalTimeSeconds = totalTime,
    )
}

// ---------------------------------------------------------------------------
// Hybrid Solver (Clarke-Wright + Sweep + 2-opt)
// ---------------------------------------------------------------------------

/**
 * Solve CVRP using hybrid approach: try both Clarke-Wright and Sweep,
 * return the better solution.
 * 
 * @param locations List of locations (depot at index 0)
 * @param numVehicles Number of vehicles available
 * @param matrix Distance/time matrix
 * @return Best CvrpResult from both algorithms
 */
fun solveCvrpHybrid(
    locations: List<CvrpLocation>,
    numVehicles: Int,
    matrix: List<List<CvrpMatrixCell>>,
): CvrpResult {
    val cwResult = solveCvrp(locations, numVehicles, matrix)
    val sweepResult = solveCvrpSweep(locations, numVehicles, matrix)
    
    // Return the one with lower total distance
    return if (cwResult.totalDistanceMeters <= sweepResult.totalDistanceMeters) {
        cwResult
    } else {
        sweepResult
    }
}

// ---------------------------------------------------------------------------
// Matrix Generation (for offline use)
// ---------------------------------------------------------------------------

/**
 * Generate a distance/time matrix using haversine formula.
 * Useful for offline scenarios where OSRM is not available.
 * 
 * @param locations List of locations
 * @param avgSpeedKmh Average speed in km/h for time estimation
 * @return Distance/time matrix
 */
fun generateHaversineMatrix(
    locations: List<CvrpLocation>,
    avgSpeedKmh: Double = 30.0,
): List<List<CvrpMatrixCell>> {
    val n = locations.size
    val matrix = mutableListOf<MutableList<CvrpMatrixCell>>()
    
    for (i in 0 until n) {
        val row = mutableListOf<CvrpMatrixCell>()
        for (j in 0 until n) {
            val distance = if (i == j) 0.0 else haversineDistance(
                locations[i].lat, locations[i].lon,
                locations[j].lat, locations[j].lon,
            )
            val time = (distance / 1000.0 / avgSpeedKmh) * 3600.0 // seconds
            row.add(CvrpMatrixCell(distance, time))
        }
        matrix.add(row)
    }
    
    return matrix
}
