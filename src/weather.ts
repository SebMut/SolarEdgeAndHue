import type { WeatherSnapshot } from './types';

interface OpenMeteoResponse {
  current?: { temperature_2m?: number; weather_code?: number; cloud_cover?: number };
  daily?: {
    time?: string[];
    sunrise?: string[];
    sunset?: string[];
    sunshine_duration?: number[];
    shortwave_radiation_sum?: number[];
  };
  hourly?: {
    time?: string[];
    global_tilted_irradiance?: number[];
    cloud_cover?: number[];
  };
}

export function estimatePvKwh(panelKwp: number, tiltedIrradiationKwhM2: number | null, performanceRatio: number): number | null {
  if (tiltedIrradiationKwhM2 === null || panelKwp <= 0) return null;
  return Math.max(0, panelKwp * tiltedIrradiationKwhM2 * Math.max(0.5, Math.min(performanceRatio, 1)));
}

export function normalizeWeather(data: OpenMeteoResponse, panelKwp: number, performanceRatio: number, fetchedAt = new Date().toISOString()): WeatherSnapshot {
  const date = data.daily?.time?.[0] ?? fetchedAt.slice(0, 10);
  const sunshineSeconds = data.daily?.sunshine_duration?.[0];
  const sunshineHours = typeof sunshineSeconds === 'number' ? sunshineSeconds / 3600 : null;
  const radiation = data.daily?.shortwave_radiation_sum?.[0];
  const shortwaveRadiationMj = typeof radiation === 'number' ? radiation : null;
  const hourlyTimes = data.hourly?.time ?? [];
  const hourlyGti = data.hourly?.global_tilted_irradiance ?? [];
  let gtiWhM2 = 0;
  let gtiCount = 0;
  hourlyTimes.forEach((time, index) => {
    if (time?.startsWith(date)) {
      const value = hourlyGti[index];
      if (typeof value === 'number' && Number.isFinite(value)) { gtiWhM2 += Math.max(0, value); gtiCount += 1; }
    }
  });
  const tiltedIrradiationKwhM2 = gtiCount > 0 ? gtiWhM2 / 1000 : (shortwaveRadiationMj !== null ? shortwaveRadiationMj / 3.6 : null);
  const cloudCoverPct = typeof data.current?.cloud_cover === 'number'
    ? data.current.cloud_cover
    : (() => {
        const values = (data.hourly?.cloud_cover ?? []).filter((value): value is number => typeof value === 'number');
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      })();
  const pvForecastKwh = estimatePvKwh(panelKwp, tiltedIrradiationKwhM2, performanceRatio);
  let solarCondition: WeatherSnapshot['solarCondition'] = 'UNKNOWN';
  if (sunshineHours !== null || shortwaveRadiationMj !== null) {
    if ((sunshineHours ?? 0) >= 6 || (shortwaveRadiationMj ?? 0) >= 14) solarCondition = 'GOOD';
    else if ((sunshineHours ?? 0) >= 3 || (shortwaveRadiationMj ?? 0) >= 8) solarCondition = 'MIXED';
    else solarCondition = 'POOR';
  }
  return {
    fetchedAt,
    date,
    temperatureC: typeof data.current?.temperature_2m === 'number' ? data.current.temperature_2m : null,
    weatherCode: typeof data.current?.weather_code === 'number' ? data.current.weather_code : null,
    sunshineHours,
    cloudCoverPct,
    shortwaveRadiationMj,
    tiltedIrradiationKwhM2,
    sunrise: data.daily?.sunrise?.[0] ?? null,
    sunset: data.daily?.sunset?.[0] ?? null,
    pvForecastKwh,
    solarCondition
  };
}

export async function fetchWeather(latitude: number, longitude: number, timezone: string, panelTilt: number, panelAzimuth: number, panelKwp: number, performanceRatio: number): Promise<WeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), timezone,
    current: 'temperature_2m,weather_code,cloud_cover',
    daily: 'sunrise,sunset,sunshine_duration,shortwave_radiation_sum',
    hourly: 'global_tilted_irradiance,cloud_cover',
    tilt: String(panelTilt), azimuth: String(panelAzimuth), forecast_days: '2'
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Wetterdienst HTTP ${response.status}`);
  return normalizeWeather(await response.json() as OpenMeteoResponse, panelKwp, performanceRatio);
}
