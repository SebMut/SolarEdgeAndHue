import { describe, expect, it } from 'vitest';
import { estimatePvKwh, normalizeWeather } from '../src/weather';

describe('weather forecast', () => {
  it('estimates PV energy from tilted irradiation', () => {
    expect(estimatePvKwh(10, 5, 0.82)).toBeCloseTo(41);
  });

  it('normalizes sunshine and radiation', () => {
    const result = normalizeWeather({
      current: { temperature_2m: 24, weather_code: 1, cloud_cover: 20 },
      daily: { time: ['2026-08-20'], sunrise: ['2026-08-20T06:05'], sunset: ['2026-08-20T20:15'], sunshine_duration: [25200], shortwave_radiation_sum: [18] },
      hourly: { time: ['2026-08-20T10:00','2026-08-20T11:00'], global_tilted_irradiance: [500,600], cloud_cover: [20,30] }
    }, 10, 0.82);
    expect(result.sunshineHours).toBe(7);
    expect(result.tiltedIrradiationKwhM2).toBeCloseTo(1.1);
    expect(result.pvForecastKwh).toBeCloseTo(9.02);
    expect(result.solarCondition).toBe('GOOD');
  });
});
