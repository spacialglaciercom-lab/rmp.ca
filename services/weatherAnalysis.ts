/**
 * Weather-enhanced route analysis: combines route data, weather conditions, and optional
 * Leap AI SDK to produce risk scores, delay estimates, and recommendations.
 */

import { Platform } from "react-native";
import type { CurrentWeather } from "./weatherService";

export interface RouteSegmentForWeather {
  /** Segment index (0-based) */
  index: number;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  /** Estimated travel time in minutes */
  estimatedMinutes: number;
  /** Optional label (e.g. street name) */
  label?: string;
}

export interface WeatherAtPoint {
  lat: number;
  lon: number;
  weather: CurrentWeather | null;
}

export interface SegmentWeatherRisk {
  segmentIndex: number;
  /** 0 = low risk, 100 = high risk */
  riskScore: number;
  /** Estimated extra minutes due to weather (e.g. slow down in rain) */
  delayMinutes: number;
  /** Primary condition for UI (e.g. "rain", "snow", "clear") */
  condition: string;
}

/** Real weather stats along the route for display (temp, wind, precip). */
export interface RouteWeatherSummary {
  /** Temperature °C: min along route */
  tempMin: number;
  /** Temperature °C: max along route */
  tempMax: number;
  /** Feels-like °C (representative) */
  feelsLike: number;
  /** Max wind speed m/s along route */
  windSpeedMax: number;
  /** Wind direction degrees (representative) */
  windDeg: number;
  /** Rain mm/h (max or sum representative) */
  rainMmh: number;
  /** Snow mm/h (max or sum representative) */
  snowMmh: number;
  /** Visibility m (minimum along route) */
  visibilityMin: number;
  /** Humidity % (representative) */
  humidity: number;
  /** Unique condition names along route (e.g. ["Clear", "Rain"]) */
  conditions: string[];
}

export interface WeatherAnalysisResult {
  /** Per-segment risk and delay */
  segmentRisks: SegmentWeatherRisk[];
  /** Overall route risk 0-100 */
  overallRiskScore: number;
  /** Total estimated weather-related delay in minutes */
  totalDelayMinutes: number;
  /** Human-readable recommendations */
  recommendations: string[];
  /** Severe conditions detected (for alert badges) */
  alerts: string[];
  /** Real weather stats along route for UI (temp, wind, precip, conditions) */
  routeWeatherSummary?: RouteWeatherSummary;
}

/**
 * Global weather penalty multiplier for edge costs (0 = no penalty, max ~0.2).
 * Use when applying weather to all segments (e.g. area forecast).
 */
export function getWeatherPenaltyMultiplier(
  weather: CurrentWeather | null,
): number {
  if (!weather) return 0;
  const { riskScore } = scoreWeather(weather);
  return Math.min(0.2, riskScore / 500);
}

/**
 * Rule-based weather risk score (0-100) and delay estimate from a single weather reading.
 */
function scoreWeather(w: CurrentWeather): {
  riskScore: number;
  delayMinutesPerHour: number;
  condition: string;
} {
  let risk = 0;
  let delayPerHour = 0;
  const cond = w.condition.main.toLowerCase();

  // Precipitation
  const rain = w.rain1h ?? 0;
  const snow = w.snow1h ?? 0;
  if (snow > 2) {
    risk += 50;
    delayPerHour += 25;
  } else if (snow > 0) {
    risk += 30;
    delayPerHour += 12;
  }
  if (rain > 5) {
    risk += 35;
    delayPerHour += 15;
  } else if (rain > 1) {
    risk += 20;
    delayPerHour += 6;
  }

  // Visibility (m)
  if (w.visibility < 500) {
    risk += 40;
    delayPerHour += 20;
  } else if (w.visibility < 1000) {
    risk += 25;
    delayPerHour += 10;
  } else if (w.visibility < 5000) {
    risk += 10;
    delayPerHour += 3;
  }

  // Wind (m/s) – high wind increases risk
  if (w.windSpeed >= 15) {
    risk += 35;
    delayPerHour += 15;
  } else if (w.windSpeed >= 10) {
    risk += 20;
    delayPerHour += 6;
  } else if (w.windSpeed >= 6) {
    risk += 10;
    delayPerHour += 2;
  }

  // Condition category
  if (cond.includes("thunder")) {
    risk += 30;
    delayPerHour += 15;
  }
  if (cond.includes("drizzle") && risk < 25) {
    risk += 15;
    delayPerHour += 4;
  }

  risk = Math.min(100, risk);
  return {
    riskScore: risk,
    delayMinutesPerHour: Math.min(60, delayPerHour),
    condition: w.condition.main || "Clear",
  };
}

/**
 * Analyze route segments with weather: rule-based scores and optional Leap recommendations.
 */
export async function analyzeRouteWeather(
  segments: RouteSegmentForWeather[],
  weatherByPoint: Map<string, CurrentWeather | null>,
  options: { useLeap?: boolean } = {},
): Promise<WeatherAnalysisResult> {
  const segmentRisks: SegmentWeatherRisk[] = [];
  const alerts: string[] = [];
  let totalDelayMinutes = 0;

  for (const seg of segments) {
    const keyFrom = `${seg.fromLat.toFixed(4)}_${seg.fromLon.toFixed(4)}`;
    const keyTo = `${seg.toLat.toFixed(4)}_${seg.toLon.toFixed(4)}`;
    const wFrom = weatherByPoint.get(keyFrom) ?? weatherByPoint.get(keyTo);
    const wTo = weatherByPoint.get(keyTo) ?? wFrom;
    const w = wFrom ?? wTo;

    if (!w) {
      segmentRisks.push({
        segmentIndex: seg.index,
        riskScore: 0,
        delayMinutes: 0,
        condition: "Unknown",
      });
      continue;
    }

    const { riskScore, delayMinutesPerHour, condition } = scoreWeather(w);
    const delayMinutes = (seg.estimatedMinutes / 60) * delayMinutesPerHour;

    if (riskScore >= 70) {
      alerts.push(`Segment ${seg.index + 1}: ${condition} – high risk`);
    }

    segmentRisks.push({
      segmentIndex: seg.index,
      riskScore,
      delayMinutes: Math.round(delayMinutes * 10) / 10,
      condition,
    });
    totalDelayMinutes += delayMinutes;
  }

  const overallRiskScore =
    segmentRisks.length === 0
      ? 0
      : Math.round(
          segmentRisks.reduce((sum, s) => sum + s.riskScore, 0) /
            segmentRisks.length,
        );

  let recommendations: string[] = [];

  if (options.useLeap && Platform.OS === "ios" && segments.length > 0) {
    try {
      const points = [
        { lat: segments[0].fromLat, lon: segments[0].fromLon },
        ...segments.map((s) => ({ lat: s.toLat, lon: s.toLon })),
      ];
      const estimatedTotalMinutes = segments.reduce(
        (s, seg) => s + seg.estimatedMinutes,
        0,
      );
      const totalDistanceKm = (estimatedTotalMinutes / 60) * 25; // rough 25 km/h
      const { getLeapWeatherRecommendations, buildLeapWeatherInput } =
        await import("@/services/leapAIService");
      const input = buildLeapWeatherInput(
        points,
        estimatedTotalMinutes,
        totalDistanceKm,
        weatherByPoint as Map<
          string,
          import("@/types/weather").WeatherData | null
        >,
      );
      const recs = await getLeapWeatherRecommendations(input);
      if (recs.length > 0) recommendations = recs;
      else if (__DEV__) {
        console.log(
          "[weatherAnalysis] Leap returned no recommendations; using rule-based fallback",
        );
      }
    } catch (e) {
      if (__DEV__) {
        console.warn(
          "[weatherAnalysis] Leap weather recommendations failed:",
          e,
        );
      }
      // Fallback to rule-based recommendations only
    }
  }

  if (recommendations.length === 0) {
    if (totalDelayMinutes >= 60) {
      const hours = Math.round(totalDelayMinutes / 60);
      recommendations.push(
        `Expect ~${hours} hour(s) of weather-related delay. Consider starting earlier.`,
      );
    }
    if (alerts.length > 0) {
      recommendations.push(
        "Some segments have high weather risk. Drive with extra caution.",
      );
    }
    if (overallRiskScore >= 70 && totalDelayMinutes > 0) {
      recommendations.push(
        "Delay start by 1–2 hours if possible to avoid peak adverse conditions.",
      );
    }
  }

  // Build real weather summary from all points along route
  const weatherValues = Array.from(weatherByPoint.values()).filter(
    (w): w is CurrentWeather => w != null,
  );
  let routeWeatherSummary: RouteWeatherSummary | undefined;
  if (weatherValues.length > 0) {
    const temps = weatherValues.map((w) => w.temp);
    const tempMin = Math.min(...temps);
    const tempMax = Math.max(...temps);
    const feelsLike =
      weatherValues.reduce((s, w) => s + w.feelsLike, 0) / weatherValues.length;
    const windSpeedMax = Math.max(...weatherValues.map((w) => w.windSpeed));
    const windDeg =
      weatherValues.reduce((s, w) => s + w.windDeg, 0) / weatherValues.length;
    const rainMmh = Math.max(...weatherValues.map((w) => w.rain1h ?? 0));
    const snowMmh = Math.max(...weatherValues.map((w) => w.snow1h ?? 0));
    const visibilityMin = Math.min(...weatherValues.map((w) => w.visibility));
    const humidity =
      weatherValues.reduce((s, w) => s + w.humidity, 0) / weatherValues.length;
    const conditionSet = new Set(
      weatherValues.map((w) => w.condition?.main || "Unknown").filter(Boolean),
    );
    routeWeatherSummary = {
      tempMin,
      tempMax,
      feelsLike: Math.round(feelsLike * 10) / 10,
      windSpeedMax,
      windDeg: Math.round(windDeg),
      rainMmh,
      snowMmh,
      visibilityMin,
      humidity: Math.round(humidity),
      conditions: Array.from(conditionSet),
    };
  }

  return {
    segmentRisks,
    overallRiskScore: Math.min(100, overallRiskScore),
    totalDelayMinutes: Math.round(totalDelayMinutes * 10) / 10,
    recommendations,
    alerts,
    routeWeatherSummary,
  };
}

/**
 * Build route segments with estimated times from a list of points (e.g. route polyline).
 * Used when we have ordered lat/lon points and assume equal time per segment for a rough estimate.
 */
export function buildSegmentsFromPoints(
  points: Array<{ lat: number; lon: number }>,
  estimatedTotalMinutes: number,
): RouteSegmentForWeather[] {
  if (points.length < 2) return [];
  const minutesPerSegment = estimatedTotalMinutes / (points.length - 1);
  return (points as Array<{ lat: number; lon: number }>)
    .slice(0, -1)
    .map((p, i) => ({
      index: i,
      fromLat: p.lat,
      fromLon: p.lon,
      toLat: points[i + 1].lat,
      toLon: points[i + 1].lon,
      estimatedMinutes: minutesPerSegment,
    }));
}
