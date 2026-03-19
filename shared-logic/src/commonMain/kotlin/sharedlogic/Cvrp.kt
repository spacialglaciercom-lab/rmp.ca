package sharedlogic

/**
 * CVRP solver API in commonMain.
 * Replace with full Clarke-Wright + 2-opt port from lib/vrp-solvers/clarke-wright.ts and two-opt.ts.
 */
data class CvrpLocation(
    val lat: Double,
    val lon: Double,
    val label: String,
)

data class CvrpMatrixCell(
    val distance: Double,
    val time: Double,
)

data class CvrpResult(
    val stops: List<CvrpLocation>,
    val routes: List<List<CvrpLocation>>,
    val totalDistanceKm: String,
    val totalTimeMin: Int,
)

private fun formatKm(meters: Double): String {
    val km = meters / 1000.0
    val intPart = km.toLong()
    val frac = ((km - intPart) * 100).toInt().coerceIn(0, 99)
    return "$intPart.${frac.toString().padStart(2, '0')}"
}

/**
 * Stub CVRP solver: returns a single route with stops in input order (depot at index 0).
 * Replace with full Clarke-Wright savings + 2-opt implementation.
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
            totalDistanceKm = "0.00",
            totalTimeMin = 0,
        )
    }
    if (locations.size == 1) {
        return CvrpResult(
            stops = locations,
            routes = listOf(locations),
            totalDistanceKm = "0.00",
            totalTimeMin = 0,
        )
    }
    val n = matrix.size
    var totalDistance = 0.0
    var totalTime = 0.0
    for (i in 0 until n - 1) {
        val cell = matrix[i].getOrNull(i + 1) ?: continue
        totalDistance += cell.distance
        totalTime += cell.time
    }
    return CvrpResult(
        stops = locations,
        routes = listOf(locations),
        totalDistanceKm = formatKm(totalDistance),
        totalTimeMin = (totalTime / 60.0).toInt(),
    )
}
