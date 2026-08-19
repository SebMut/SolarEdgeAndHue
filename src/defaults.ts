import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  locationName: '85622 Feldkirchen bei München',
  latitude: 48.148,
  longitude: 11.733,
  timezone: 'Europe/Berlin',
  checkTime: '06:00',
  automationEnabled: false,
  mode: 'AUTO',
  manualUntil: null,
  ruleJoiner: 'AND',
  rules: [
    { id: 'weather-sun', label: 'Sonnenstunden', metric: 'sunshineHours', operator: '>=', threshold: 5, enabled: true },
    { id: 'forecast', label: 'PV-Prognose', metric: 'pvForecastKwh', operator: '>=', threshold: 10, enabled: true }
  ],
  offAfterTime: '20:00',
  minRunMinutes: 45,
  minOffMinutes: 30,
  maxDailyRuntimeMinutes: 480,
  lowSurplusThresholdKw: null,
  maxGridImportKw: null,
  offDelayMinutes: 15,
  solarEdgeSiteId: '',
  panelKwp: 10,
  panelTilt: 30,
  panelAzimuth: 0,
  performanceRatio: 0.82,
  hueResourceId: '',
  hueResourceName: ''
};
