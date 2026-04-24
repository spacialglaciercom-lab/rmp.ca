package com.routemasterpro.routeoptimizer

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Expo native module — Android side.
 *
 * The Rust rmp-routing library is reached through the UniFFI-generated Kotlin
 * bindings that live in `uniffi.rmp_routing` *once they have been generated*:
 *
 *   1. ./mobile-core/scripts/build-android.sh          # produces librmp_routing.so
 *   2. cargo run -p uniffi-bindgen -- generate \
 *        --library mobile-core/target/release/librmp_routing.so \
 *        --language kotlin \
 *        --out-dir modules/route-optimizer/android/src/main/java
 *
 * Step 2 drops `uniffi/rmp_routing/rmp_routing.kt` into the source tree.  Once
 * that file is present, the companion-object `NATIVE_AVAILABLE` flag flips to
 * true and `solveRoute` dispatches through UniFFI (via reflection so this
 * module compiles without the generated file).  Until then we use a pure-
 * Kotlin nearest-neighbor so the app still works on Android during dev.
 */
class RouteOptimizerModule : Module() {

    companion object {
        private val NATIVE_AVAILABLE: Boolean = loadNativeBindings()

        private fun loadNativeBindings(): Boolean = try {
            System.loadLibrary("rmp_routing")
            Class.forName("uniffi.rmp_routing.Rmp_routingKt")
            true
        } catch (_: UnsatisfiedLinkError) {
            false
        } catch (_: ClassNotFoundException) {
            false
        }
    }

    override fun definition() = ModuleDefinition {
        Name("RouteOptimizer")

        AsyncFunction("solveRoute") {
            rawPoints: List<Map<String, Any?>>,
            depotIndex: Int?,
            rawOptions: Map<String, Any?>,
            promise: Promise,
            ->
            CoroutineScope(Dispatchers.Default).launch {
                try {
                    val points  = rawPoints.map(::parsePoint)
                    val options = parseOptions(rawOptions)
                    val result =
                        if (NATIVE_AVAILABLE) solveNative(points, depotIndex, options)
                        else                  solveKotlin(points, depotIndex ?: 0, options)
                    promise.resolve(result)
                } catch (e: Exception) {
                    promise.reject("ROUTING_ERROR", e.message ?: "Unknown routing error", e)
                }
            }
        }

        Function("haversineMeters") {
            lat1: Double, lon1: Double, lat2: Double, lon2: Double,
            ->
            haversineKotlin(lat1, lon1, lat2, lon2)
        }
    }

    // ─── UniFFI dispatch (reflection) ─────────────────────────────────────────
    //
    // Reflection keeps this file compilable even when `uniffi.rmp_routing.*`
    // has not been generated yet.  Once the build pipeline is stable, swap
    // this block for a direct `import uniffi.rmp_routing.*` + plain call.

    private fun solveNative(
        points: List<SolverPoint>,
        depotIndex: Int?,
        options: SolverOptions,
    ): Map<String, Any> {
        val uniffiPkg = Class.forName("uniffi.rmp_routing.Rmp_routingKt")

        val solverPointCls = Class.forName("uniffi.rmp_routing.SolverPoint")
        val nativePoints = points.map { p ->
            solverPointCls.getConstructor(
                String::class.java,
                Double::class.javaPrimitiveType,
                Double::class.javaPrimitiveType,
                java.lang.Double::class.java,
                java.lang.Double::class.java,
            ).newInstance(p.id, p.lat, p.lon, p.demand, p.serviceTime)
        }

        val algorithmCls = Class.forName("uniffi.rmp_routing.SolverAlgorithm")
        val alg = algorithmCls.enumConstants.first {
            (it as Enum<*>).name == options.algorithm.uniffiName
        }

        val solverOptionsCls = Class.forName("uniffi.rmp_routing.SolverOptions")
        val nativeOptions = solverOptionsCls.getConstructor(
            algorithmCls,
            Boolean::class.javaPrimitiveType,
            java.lang.Integer::class.java,
        ).newInstance(alg, options.returnToDepot, options.maxIterations)

        val solveRoute = uniffiPkg.getMethod(
            "solveRoute",
            List::class.java,
            java.lang.Integer::class.java,
            solverOptionsCls,
        )
        val nativeResult = solveRoute.invoke(null, nativePoints, depotIndex, nativeOptions)!!
        return reflectResult(nativeResult)
    }

    @Suppress("UNCHECKED_CAST")
    private fun reflectResult(nativeResult: Any): Map<String, Any> {
        val cls = nativeResult.javaClass
        val orderedIds     = cls.getMethod("getOrderedIds")    .invoke(nativeResult) as List<String>
        val totalDistanceM = cls.getMethod("getTotalDistanceM").invoke(nativeResult) as Double
        val totalDurationS = cls.getMethod("getTotalDurationS").invoke(nativeResult) as Double
        val algorithm      = cls.getMethod("getAlgorithm")     .invoke(nativeResult) as String
        val solveTimeMs    = cls.getMethod("getSolveTimeMs")   .invoke(nativeResult) as Long
        val segments       = (cls.getMethod("getSegments").invoke(nativeResult) as List<Any>).map { seg ->
            val sc = seg.javaClass
            mapOf(
                "fromId"    to (sc.getMethod("getFromId")   .invoke(seg) as String),
                "toId"      to (sc.getMethod("getToId")     .invoke(seg) as String),
                "distanceM" to (sc.getMethod("getDistanceM").invoke(seg) as Double),
                "durationS" to (sc.getMethod("getDurationS").invoke(seg) as Double),
            )
        }
        return mapOf(
            "orderedIds"     to orderedIds,
            "totalDistanceM" to totalDistanceM,
            "totalDurationS" to totalDurationS,
            "segments"       to segments,
            "algorithm"      to algorithm,
            "solveTimeMs"    to solveTimeMs,
        )
    }

    // ─── Pure-Kotlin fallback ─────────────────────────────────────────────────

    private fun solveKotlin(
        points: List<SolverPoint>,
        depotIndex: Int,
        options: SolverOptions,
    ): Map<String, Any> {
        require(points.isNotEmpty()) { "points list is empty" }
        val start  = System.currentTimeMillis()
        val matrix = buildMatrix(points)
        val order  = nearestNeighbor(matrix, depotIndex).toMutableList()
        if (options.returnToDepot) order.add(depotIndex)

        val speedMs = 30.0 * 1000.0 / 3600.0
        val segments = mutableListOf<Map<String, Any>>()
        var totalDist = 0.0; var totalDur = 0.0
        for (i in 0 until order.size - 1) {
            val from = order[i]; val to = order[i + 1]
            val dist    = matrix[from][to]
            val travel  = dist / speedMs
            val service = points[to].serviceTime ?: 120.0
            totalDist += dist; totalDur += travel + service
            segments.add(mapOf(
                "fromId"    to points[from].id,
                "toId"      to points[to].id,
                "distanceM" to dist,
                "durationS" to (travel + service),
            ))
        }

        return mapOf(
            "orderedIds"     to order.map { points[it].id },
            "totalDistanceM" to totalDist,
            "totalDurationS" to totalDur,
            "segments"       to segments,
            "algorithm"      to "nearest-neighbor (Kotlin fallback)",
            "solveTimeMs"    to (System.currentTimeMillis() - start),
        )
    }

    private fun buildMatrix(points: List<SolverPoint>): Array<DoubleArray> =
        Array(points.size) { i ->
            DoubleArray(points.size) { j ->
                if (i == j) 0.0
                else haversineKotlin(points[i].lat, points[i].lon, points[j].lat, points[j].lon)
            }
        }

    private fun nearestNeighbor(matrix: Array<DoubleArray>, depot: Int): List<Int> {
        val n       = matrix.size
        val visited = BooleanArray(n); visited[depot] = true
        val order   = mutableListOf(depot)
        while (order.size < n) {
            val last = order.last()
            val next = (0 until n).filter { !visited[it] }.minBy { matrix[last][it] }
            visited[next] = true; order.add(next)
        }
        return order
    }

    private fun haversineKotlin(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val R     = 6_371_000.0
        val dLat  = Math.toRadians(lat2 - lat1)
        val dLon  = Math.toRadians(lon2 - lon1)
        val sinLat = Math.sin(dLat / 2); val sinLon = Math.sin(dLon / 2)
        val a = sinLat * sinLat +
            Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * sinLon * sinLon
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }

    // ─── Input parsing ────────────────────────────────────────────────────────

    private fun parsePoint(dict: Map<String, Any?>): SolverPoint = SolverPoint(
        id          = dict["id"]          as? String ?: error("SolverPoint.id is required"),
        lat         = (dict["lat"]         as? Number)?.toDouble() ?: error("SolverPoint.lat is required"),
        lon         = (dict["lon"]         as? Number)?.toDouble() ?: error("SolverPoint.lon is required"),
        demand      = (dict["demand"]      as? Number)?.toDouble(),
        serviceTime = (dict["serviceTime"] as? Number)?.toDouble(),
    )

    private fun parseOptions(dict: Map<String, Any?>): SolverOptions = SolverOptions(
        algorithm = when (dict["algorithm"] as? String) {
            "nearest-neighbor" -> Algorithm.NEAREST_NEIGHBOR
            else               -> Algorithm.TWO_OPT
        },
        returnToDepot = (dict["returnToDepot"] as? Boolean) ?: false,
        maxIterations = (dict["maxIterations"] as? Number)?.toInt(),
    )
}

// ─── Local models ─────────────────────────────────────────────────────────────

private data class SolverPoint(
    val id: String,
    val lat: Double,
    val lon: Double,
    val demand: Double?,
    val serviceTime: Double?,
)

private enum class Algorithm(val uniffiName: String) {
    NEAREST_NEIGHBOR("NEAREST_NEIGHBOR"),
    TWO_OPT("TWO_OPT"),
}

private data class SolverOptions(
    val algorithm: Algorithm,
    val returnToDepot: Boolean,
    val maxIterations: Int?,
)
