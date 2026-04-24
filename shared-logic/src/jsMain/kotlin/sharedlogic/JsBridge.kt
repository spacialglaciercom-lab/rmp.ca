package sharedlogic

import kotlin.js.ExperimentalJsExport
import kotlin.js.JsExport

@OptIn(ExperimentalJsExport::class)
@JsExport
object SharedLogicBridge {

    fun solveCvrp(
        locations: Array<dynamic>,
        numVehicles: Int,
        matrix: Array<Array<dynamic>>,
    ): CvrpResult {
        val locs = locations.map { loc ->
            CvrpLocation(
                lat = (loc["lat"] as? Number)?.toDouble() ?: 0.0,
                lon = (loc["lon"] as? Number)?.toDouble() ?: 0.0,
                label = (loc["label"] as? String) ?: "",
            )
        }
        val mat = matrix.map { row ->
            row.map { cell ->
                CvrpMatrixCell(
                    distance = (cell["distance"] as? Number)?.toDouble() ?: 0.0,
                    time = (cell["time"] as? Number)?.toDouble() ?: 0.0,
                )
            }
        }
        return solveCvrp(locs, numVehicles, mat)
    }
}
