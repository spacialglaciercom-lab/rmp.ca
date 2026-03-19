/**
 * Weather integration types: API responses, cache, and Leap AI schema.
 */

export interface WeatherCondition {
  id: number;
  main: string;
  description: string;
  icon: string;
}

export interface WeatherData {
  lat: number;
  lon: number;
  timestamp: number;
  temp: number;
  feelsLike: number;
  pressure: number;
  humidity: number;
  visibility: number;
  windSpeed: number;
  windDeg: number;
  clouds: number;
  condition: WeatherCondition;
  rain1h?: number;
  snow1h?: number;
}

export interface RoutePoint {
  lat: number;
  lon: number;
  /** Estimated time from route start (minutes) */
  estimatedMinutes?: number;
  label?: string;
}

export interface RouteData {
  points: RoutePoint[];
  totalDistanceKm: number;
  estimatedTotalMinutes: number;
  segmentCount: number;
}

export interface WeatherConstraints {
  maxWindSpeed: number; // m/s
  minVisibility: number; // meters
  maxPrecipitationRate: number; // mm/h
}

export interface LeapWeatherInput {
  route: RouteData;
  weatherConditions: WeatherData[];
  constraints: WeatherConstraints;
}

export interface WeatherCacheEntry {
  data: WeatherData;
  fetchedAt: number;
}

export const DEFAULT_WEATHER_CONSTRAINTS: WeatherConstraints = {
  maxWindSpeed: 15,
  minVisibility: 1000,
  maxPrecipitationRate: 5,
};
