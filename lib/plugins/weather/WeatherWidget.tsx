/**
 * Weather plugin widget — lazy-loaded dashboard section.
 * Wraps the existing HomeWeatherSection so the plugin owns the weather UI when enabled.
 */

import React from "react";
import { HomeWeatherSection } from "@/components/HomeWeatherSection";

export default function WeatherWidget() {
  return <HomeWeatherSection />;
}
