export type Mode = 'AUTO' | 'MANUAL_ON' | 'MANUAL_OFF';
export type Joiner = 'AND' | 'OR';
export type Operator = '>' | '>=' | '<' | '<=';

export type MetricName =
  | 'pvCurrentKw'
  | 'dailyEnergyKwh'
  | 'consumptionKw'
  | 'gridImportKw'
  | 'feedInKw'
  | 'batterySoc'
  | 'pvSurplusKw'
  | 'sunshineHours'
  | 'cloudCoverPct'
  | 'shortwaveRadiationMj'
  | 'pvForecastKwh';

export interface Rule {
  id: string;
  label: string;
  metric: MetricName;
  operator: Operator;
  threshold: number;
  enabled: boolean;
}

export interface Settings {
  locationName: string;
  latitude: number;
  longitude: number;
  timezone: string;
  checkTime: string;
  automationEnabled: boolean;
  mode: Mode;
  manualUntil: string | null;
  ruleJoiner: Joiner;
  rules: Rule[];
  offAfterTime: string;
  minRunMinutes: number;
  minOffMinutes: number;
  maxDailyRuntimeMinutes: number;
  lowSurplusThresholdKw: number | null;
  maxGridImportKw: number | null;
  offDelayMinutes: number;
  solarEdgeSiteId: string;
  panelKwp: number;
  panelTilt: number;
  panelAzimuth: number;
  performanceRatio: number;
  hueResourceId: string;
  hueResourceName: string;
}

export interface SecretSettings {
  solarEdgeApiKey?: string;
  hueClientId?: string;
  hueClientSecret?: string;
  hueAccessToken?: string;
  hueRefreshToken?: string;
  hueUsername?: string;
  hueAccessTokenExpiresAt?: string;
}

export interface SolarSnapshot {
  fetchedAt: string;
  pvCurrentKw: number | null;
  dailyEnergyKwh: number | null;
  consumptionKw: number | null;
  gridImportKw: number | null;
  feedInKw: number | null;
  batterySoc: number | null;
  pvSurplusKw: number | null;
  availableMetrics: MetricName[];
}

export interface WeatherSnapshot {
  fetchedAt: string;
  date: string;
  temperatureC: number | null;
  weatherCode: number | null;
  sunshineHours: number | null;
  cloudCoverPct: number | null;
  shortwaveRadiationMj: number | null;
  tiltedIrradiationKwhM2: number | null;
  sunrise: string | null;
  sunset: string | null;
  pvForecastKwh: number | null;
  solarCondition: 'GOOD' | 'MIXED' | 'POOR' | 'UNKNOWN';
}

export interface RuleResult {
  rule: Rule;
  actual: number | null;
  passed: boolean;
  missing: boolean;
  message: string;
}

export interface EvaluationResult {
  evaluatedAt: string;
  shouldTurnOn: boolean;
  action: 'ON' | 'OFF' | 'KEEP_ON' | 'KEEP_OFF' | 'BLOCKED' | 'SIMULATE_ON' | 'SIMULATE_OFF';
  reason: string;
  ruleResults: RuleResult[];
  solar: SolarSnapshot | null;
  weather: WeatherSnapshot | null;
  simulation: boolean;
}

export interface DashboardData {
  setupComplete: boolean;
  authenticated: boolean;
  settings?: Settings;
  solar?: SolarSnapshot | null;
  weather?: WeatherSnapshot | null;
  lastEvaluation?: EvaluationResult | null;
  hue?: { connected: boolean; on: boolean | null; name: string; lastError?: string };
  health?: Record<string, { ok: boolean; message: string; updatedAt?: string }>;
  dailyRuntimeMinutes?: number;
}
