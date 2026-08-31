import { useCallback, useEffect, useState } from "react";
import {
  FiCloud,
  FiCloudDrizzle,
  FiCloudLightning,
  FiCloudRain,
  FiCloudSnow,
  FiSun,
  FiWind,
} from "react-icons/fi";
import type { WidgetSize } from "./widgetLayout";

// WMO weather codes → Feather icons with the widget weather palette
// (APPEND_WIDGETS_VISUAL §2): sun/rain/cloud are information colors, kept
// narrow to iconography so a sun and a rain cloud stay readable apart.
function condition(code: number): { icon: React.ReactNode; tint: string } {
  if (code === 0 || code === 1) return { icon: <FiSun aria-hidden="true" />, tint: "text-weather-sun" };
  if (code === 2 || code === 3) return { icon: <FiCloud aria-hidden="true" />, tint: "text-weather-cloud" };
  if (code === 45 || code === 48) return { icon: <FiWind aria-hidden="true" />, tint: "text-weather-cloud" };
  if (code >= 51 && code <= 57) return { icon: <FiCloudDrizzle aria-hidden="true" />, tint: "text-weather-rain" };
  if (code >= 61 && code <= 67) return { icon: <FiCloudRain aria-hidden="true" />, tint: "text-weather-rain" };
  if (code >= 71 && code <= 77) return { icon: <FiCloudSnow aria-hidden="true" />, tint: "text-weather-cloud" };
  if (code >= 80 && code <= 82) return { icon: <FiCloudRain aria-hidden="true" />, tint: "text-weather-rain" };
  if (code === 85 || code === 86) return { icon: <FiCloudSnow aria-hidden="true" />, tint: "text-weather-cloud" };
  if (code >= 95) return { icon: <FiCloudLightning aria-hidden="true" />, tint: "text-weather-rain" };
  return { icon: <FiCloud aria-hidden="true" />, tint: "text-weather-cloud" };
}

interface WeatherLocation {
  lat: number;
  lon: number;
  label: string;
}

interface WeatherData {
  location: string;
  temp: number;
  code: number;
  humidity: number;
  updatedAt: number;
  daily: { day: string; code: number; max: number; min: number }[];
}

const REFRESH_MS = 30 * 60 * 1000;
const coordsKey = (id: string) => `aqua.weather.coords.${id}`;
const cacheKey = (id: string) => `aqua.weather.cache.${id}`;

function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // widget still works in-memory when storage is unavailable
  }
}

async function resolveLocation(id: string): Promise<WeatherLocation> {
  const cached = readStorage<WeatherLocation>(coordsKey(id));
  if (cached) return cached;
  const geo = await fetch("https://ipapi.co/json/");
  if (!geo.ok) throw new Error("Geolocation failed");
  const body: { latitude?: number; longitude?: number; city?: string; region?: string; country_name?: string } = await geo.json();
  if (typeof body.latitude !== "number" || typeof body.longitude !== "number") {
    throw new Error("Geolocation returned no coordinates");
  }
  const label = [body.city, body.region, body.country_name].filter(Boolean).join(", ") || "Current location";
  const location: WeatherLocation = { lat: body.latitude, lon: body.longitude, label };
  writeStorage(coordsKey(id), location);
  return location;
}

async function fetchWeather(location: WeatherLocation, days: number): Promise<Omit<WeatherData, "updatedAt">> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=${days}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather fetch failed: ${res.status}`);
  const body: {
    current?: { temperature_2m?: number; relative_humidity_2m?: number; weather_code?: number };
    daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[] };
  } = await res.json();
  if (!body.current || typeof body.current.temperature_2m !== "number") {
    throw new Error("Weather API returned an unexpected shape");
  }
  return {
    location: location.label,
    temp: Math.round(body.current.temperature_2m),
    code: body.current.weather_code ?? 0,
    humidity: Math.round(body.current.relative_humidity_2m ?? 0),
    daily: (body.daily?.time ?? []).map((day, i) => ({
      day,
      code: body.daily?.weather_code?.[i] ?? 0,
      max: Math.round(body.daily?.temperature_2m_max?.[i] ?? 0),
      min: Math.round(body.daily?.temperature_2m_min?.[i] ?? 0),
    })),
  };
}

export function WeatherWidget({ size, id }: { size: WidgetSize; id: string }) {
  const [data, setData] = useState<WeatherData | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  const load = useCallback(
    async (force: boolean) => {
      setStatus("loading");
      try {
        if (!force) {
          const cached = readStorage<WeatherData>(cacheKey(id));
          if (cached && Date.now() - cached.updatedAt < REFRESH_MS) {
            setData(cached);
            setStatus("ok");
            return;
          }
        }
        const location = await resolveLocation(id);
        const days = size === "medium" ? 5 : 1;
        const weather = await fetchWeather(location, days);
        const next: WeatherData = { ...weather, updatedAt: Date.now() };
        writeStorage(cacheKey(id), next);
        setData(next);
        setStatus("ok");
      } catch {
        // keep last known data on screen; only a cold widget shows the error view
        setStatus("error");
      }
    },
    [id, size],
  );

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!data) {
    if (status === "error") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-xs text-text-tertiary">
          <span>Weather unavailable</span>
          <button className="rounded bg-bg-hover px-2 py-1 text-[11px] hover:bg-bg-hover/80" onClick={() => void load(true)}>
            Retry
          </button>
        </div>
      );
    }
    return <div className="flex h-full items-center justify-center p-4 text-xs text-text-tertiary">Loading weather…</div>;
  }

  const current = condition(data.code);
  return (
    <div className="flex h-full flex-col p-4">
      <div className="flex items-center gap-3">
        <span className={`text-2xl ${current.tint}`}>{current.icon}</span>
        <p className="text-4xl font-semibold tabular-nums text-text-primary">{data.temp}°</p>
      </div>
      <p className="mt-1 truncate text-[11px] text-text-secondary">{data.location}</p>
      <p className="text-[11px] text-text-tertiary">{data.humidity}% humidity</p>
      {size === "medium" && data.daily.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-white/10 pt-2">
          {data.daily.map((d) => {
            const c = condition(d.code);
            return (
              <li key={d.day} className="flex items-center justify-between text-[11px]">
                <span className="w-8 text-text-secondary">
                  {new Date(`${d.day}T00:00:00`).toLocaleDateString([], { weekday: "short" })}
                </span>
                <span className={c.tint}>{c.icon}</span>
                <span className="tabular-nums text-text-secondary">
                  {d.max}° <span className="text-text-tertiary">/ {d.min}°</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
