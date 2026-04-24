import ExpoModulesCore
import CoreLocation

// `RmpRouting` is the Swift module produced by `uniffi-bindgen` from the Rust
// crate at mobile-core/rmp-routing.  Run `mobile-core/scripts/build-ios.sh`
// to produce the XCFramework and RmpRouting.swift before an iOS build.
//
// The exported symbols (matching what uniffi-bindgen emits):
//   func solveRoute(points: [SolverPoint], depot: UInt32?, options: SolverOptions) throws -> SolverResult
//   func haversineMeters(lat1:lon1:lat2:lon2:) -> Double
//   struct SolverPoint      { let id: String; let lat, lon: Double; let demand, serviceTime: Double? }
//   struct SolverOptions    { let algorithm: SolverAlgorithm; let returnToDepot: Bool; let maxIterations: UInt32? }
//   struct SolverResult     { let orderedIds: [String]; let totalDistanceM, totalDurationS: Double;
//                             let segments: [RouteSegment]; let algorithm: String; let solveTimeMs: UInt64 }
//   struct RouteSegment     { let fromId, toId: String; let distanceM, durationS: Double }
//   enum   SolverAlgorithm  { case nearestNeighbor, twoOpt }
//   enum   RoutingError     { case EmptyInput, InvalidDepot(UInt32) }
#if canImport(RmpRouting)
import RmpRouting
#endif

/// Expo native module — wraps the Rust `rmp-routing` solver for React Native.
///
/// Swift Concurrency (async/await) is used throughout so calls from JavaScript
/// never block the main thread.  Rust types are `Send + Sync` and safe to call
/// from any background executor; Expo's `AsyncFunction` already dispatches us
/// off the JS thread.
public class RouteOptimizerModule: Module {

    public func definition() -> ModuleDefinition {
        Name("RouteOptimizer")

        // MARK: - Async route solver

        AsyncFunction("solveRoute") {
            (
                rawPoints: [[String: Any]],
                depotIndex: Int?,
                rawOptions: [String: Any]
            ) -> [String: Any] in

            let points  = try rawPoints.map(Self.makePoint(from:))
            let options = Self.makeOptions(from: rawOptions)
            let depot   = depotIndex.map { UInt32($0) }

            let result = try solveRoute(points: points, depot: depot, options: options)
            return Self.resultAsDictionary(result)
        }

        // MARK: - Sync haversine helper

        Function("haversineMeters") {
            (lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double in
            haversineMeters(lat1: lat1, lon1: lon1, lat2: lat2, lon2: lon2)
        }
    }

    // MARK: - JS → Rust mapping

    private static func makePoint(from dict: [String: Any]) throws -> SolverPoint {
        guard
            let id  = dict["id"]  as? String,
            let lat = dict["lat"] as? Double,
            let lon = dict["lon"] as? Double
        else {
            throw RouteOptimizerError.invalidPoint
        }
        return SolverPoint(
            id:          id,
            lat:         lat,
            lon:         lon,
            demand:      dict["demand"]      as? Double,
            serviceTime: dict["serviceTime"] as? Double
        )
    }

    private static func makeOptions(from dict: [String: Any]) -> SolverOptions {
        let alg: SolverAlgorithm
        switch (dict["algorithm"] as? String) ?? "2-opt" {
        case "nearest-neighbor": alg = .nearestNeighbor
        default:                 alg = .twoOpt
        }
        return SolverOptions(
            algorithm:     alg,
            returnToDepot: (dict["returnToDepot"] as? Bool) ?? false,
            maxIterations: (dict["maxIterations"] as? Int).map { UInt32($0) }
        )
    }

    // MARK: - Rust → JS mapping

    private static func resultAsDictionary(_ r: SolverResult) -> [String: Any] {
        [
            "orderedIds":     r.orderedIds,
            "totalDistanceM": r.totalDistanceM,
            "totalDurationS": r.totalDurationS,
            "algorithm":      r.algorithm,
            "solveTimeMs":    r.solveTimeMs,
            "segments":       r.segments.map { seg in
                [
                    "fromId":    seg.fromId,
                    "toId":      seg.toId,
                    "distanceM": seg.distanceM,
                    "durationS": seg.durationS,
                ] as [String: Any]
            },
        ]
    }
}

// MARK: - Convenience for CLLocationCoordinate2D call sites

extension SolverPoint {
    /// Build a SolverPoint from a CoreLocation coordinate.
    /// Mirrors the JS SolverPoint shape so existing call sites can mix freely.
    init(
        id: String,
        coordinate: CLLocationCoordinate2D,
        demand: Double? = nil,
        serviceTime: Double? = nil
    ) {
        self.init(
            id:          id,
            lat:         coordinate.latitude,
            lon:         coordinate.longitude,
            demand:      demand,
            serviceTime: serviceTime
        )
    }
}

// MARK: - Errors

enum RouteOptimizerError: Error, LocalizedError {
    case invalidPoint

    var errorDescription: String? {
        "SolverPoint must have 'id' (String), 'lat' (Double), and 'lon' (Double)."
    }
}

// MARK: - Stub types (used when RmpRouting.xcframework has not been built yet)
//
// These compile-time fallbacks let the rest of the iOS app build even before
// `build-ios.sh` has produced the framework.  They are automatically disabled
// (`#if !canImport(RmpRouting)`) once the real module is linked in.

#if !canImport(RmpRouting)
public enum SolverAlgorithm { case nearestNeighbor, twoOpt }

public struct SolverPoint {
    public let id: String
    public let lat: Double; public let lon: Double
    public let demand: Double?; public let serviceTime: Double?
    public init(id: String, lat: Double, lon: Double, demand: Double?, serviceTime: Double?) {
        self.id = id; self.lat = lat; self.lon = lon
        self.demand = demand; self.serviceTime = serviceTime
    }
}

public struct SolverOptions {
    public let algorithm: SolverAlgorithm
    public let returnToDepot: Bool
    public let maxIterations: UInt32?
    public init(algorithm: SolverAlgorithm, returnToDepot: Bool, maxIterations: UInt32?) {
        self.algorithm = algorithm; self.returnToDepot = returnToDepot; self.maxIterations = maxIterations
    }
}

public struct RouteSegment {
    public let fromId: String; public let toId: String
    public let distanceM: Double; public let durationS: Double
}

public struct SolverResult {
    public let orderedIds: [String]
    public let totalDistanceM: Double; public let totalDurationS: Double
    public let segments: [RouteSegment]
    public let algorithm: String; public let solveTimeMs: UInt64
}

public enum RoutingError: Error { case emptyInput, invalidDepot(UInt32) }

/// Pure-Swift nearest-neighbor so the iOS target compiles without the XCFramework.
/// Replaced by the Rust implementation once `build-ios.sh` has been run.
public func solveRoute(
    points: [SolverPoint], depot: UInt32?, options: SolverOptions
) throws -> SolverResult {
    guard !points.isEmpty else { throw RoutingError.emptyInput }
    let start = Date()
    let depotIdx = Int(depot ?? 0)
    guard depotIdx < points.count else { throw RoutingError.invalidDepot(depot ?? 0) }

    var visited = Array(repeating: false, count: points.count)
    var order   = [depotIdx]; visited[depotIdx] = true
    while order.count < points.count {
        let last = order.last!
        let (next, _) = (0..<points.count)
            .filter { !visited[$0] }
            .map { ($0, haversineMeters(
                lat1: points[last].lat, lon1: points[last].lon,
                lat2: points[$0].lat,  lon2: points[$0].lon
            )) }
            .min { $0.1 < $1.1 }!
        visited[next] = true; order.append(next)
    }
    if options.returnToDepot { order.append(depotIdx) }

    let speedMs = 30.0 * 1000.0 / 3600.0
    var segs = [RouteSegment]()
    var totalDist = 0.0; var totalDur = 0.0
    for i in 0..<(order.count - 1) {
        let (f, t) = (order[i], order[i+1])
        let d = haversineMeters(
            lat1: points[f].lat, lon1: points[f].lon,
            lat2: points[t].lat, lon2: points[t].lon
        )
        let travel = d / speedMs
        let service = points[t].serviceTime ?? 120.0
        totalDist += d; totalDur += travel + service
        segs.append(RouteSegment(
            fromId: points[f].id, toId: points[t].id,
            distanceM: d, durationS: travel + service
        ))
    }

    return SolverResult(
        orderedIds:     order.map { points[$0].id },
        totalDistanceM: totalDist, totalDurationS: totalDur,
        segments:       segs,
        algorithm:      "nearest-neighbor (Swift stub)",
        solveTimeMs:    UInt64(-start.timeIntervalSinceNow * 1000)
    )
}

public func haversineMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
    let R = 6_371_000.0
    let dLat = (lat2 - lat1) * .pi / 180
    let dLon = (lon2 - lon1) * .pi / 180
    let sinLat = sin(dLat / 2); let sinLon = sin(dLon / 2)
    let a = sinLat * sinLat
        + cos(lat1 * .pi/180) * cos(lat2 * .pi/180) * sinLon * sinLon
    return R * 2 * atan2(a.squareRoot(), (1-a).squareRoot())
}
#endif
