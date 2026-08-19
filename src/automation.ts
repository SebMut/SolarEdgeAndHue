import { minutesSince, partsInTimezone } from './time';
import type { EvaluationResult, MetricName, Rule, RuleResult, Settings, SolarSnapshot, WeatherSnapshot } from './types';

function compare(actual: number, operator: Rule['operator'], threshold: number): boolean {
  switch (operator) {
    case '>': return actual > threshold;
    case '>=': return actual >= threshold;
    case '<': return actual < threshold;
    case '<=': return actual <= threshold;
  }
}

export function metricValue(metric: MetricName, solar: SolarSnapshot | null, weather: WeatherSnapshot | null): number | null {
  if (metric in (solar ?? {})) return (solar as unknown as Record<string, number | null>)[metric] ?? null;
  if (metric in (weather ?? {})) return (weather as unknown as Record<string, number | null>)[metric] ?? null;
  return null;
}

export function evaluateRules(settings: Settings, solar: SolarSnapshot | null, weather: WeatherSnapshot | null): RuleResult[] {
  return settings.rules.filter((rule) => rule.enabled).map((rule) => {
    const actual = metricValue(rule.metric, solar, weather);
    const missing = actual === null || !Number.isFinite(actual);
    const passed = !missing && compare(actual, rule.operator, rule.threshold);
    return { rule, actual, missing, passed, message: missing ? `${rule.label}: Messwert fehlt` : `${rule.label}: ${actual!.toFixed(2)} ${rule.operator} ${rule.threshold}` };
  });
}

export function rulesPass(settings: Settings, results: RuleResult[]): boolean {
  if (results.length === 0) return false;
  return settings.ruleJoiner === 'AND' ? results.every((result) => result.passed) : results.some((result) => result.passed);
}

export interface EvaluateOptions {
  settings: Settings;
  solar: SolarSnapshot | null;
  weather: WeatherSnapshot | null;
  currentOn: boolean | null;
  lastChangedAt: string | null;
  dailyRuntimeMinutes: number;
  now?: Date;
  simulation?: boolean;
  sustainedOffConditionMinutes?: number;
}

export function evaluateAutomation(options: EvaluateOptions): EvaluationResult {
  const { settings, solar, weather, currentOn, lastChangedAt, dailyRuntimeMinutes } = options;
  const now = options.now ?? new Date();
  const simulation = options.simulation ?? false;
  const results = evaluateRules(settings, solar, weather);
  const local = partsInTimezone(now, settings.timezone);
  const failSafeMissing = results.some((result) => result.missing);
  const passed = rulesPass(settings, results);
  const sinceChange = minutesSince(lastChangedAt, now);
  const autoActive = settings.automationEnabled && settings.mode === 'AUTO';

  const base = { evaluatedAt: now.toISOString(), ruleResults: results, solar, weather, simulation };
  if (simulation) {
    return { ...base, shouldTurnOn: passed && !failSafeMissing, action: passed && !failSafeMissing ? 'SIMULATE_ON' : 'SIMULATE_OFF', reason: failSafeMissing ? 'Simulation: notwendiger Messwert fehlt.' : passed ? 'Simulation: alle erforderlichen Regeln sind erfüllt.' : 'Simulation: Regeln sind nicht erfüllt.' };
  }
  if (settings.mode === 'MANUAL_ON') return { ...base, shouldTurnOn: true, action: currentOn ? 'KEEP_ON' : 'ON', reason: 'Manuell EIN ist aktiv.' };
  if (settings.mode === 'AUTO' && local.time < settings.checkTime && currentOn !== true) return { ...base, shouldTurnOn: false, action: 'KEEP_OFF', reason: `Automatik startet heute erst ab ${settings.checkTime}.` };
  if (settings.mode === 'MANUAL_OFF') return { ...base, shouldTurnOn: false, action: currentOn ? 'OFF' : 'KEEP_OFF', reason: 'Manuell AUS ist aktiv.' };
  if (!autoActive) return { ...base, shouldTurnOn: currentOn === true, action: 'BLOCKED', reason: 'Automatik ist deaktiviert.' };
  if (failSafeMissing) return { ...base, shouldTurnOn: false, action: currentOn ? 'KEEP_ON' : 'KEEP_OFF', reason: 'Fail-Safe: mindestens ein erforderlicher Messwert fehlt; es wird nicht neu eingeschaltet.' };
  if (dailyRuntimeMinutes >= settings.maxDailyRuntimeMinutes) {
    if (currentOn && (sinceChange === null || sinceChange >= settings.minRunMinutes)) return { ...base, shouldTurnOn: false, action: 'OFF', reason: 'Maximale Tageslaufzeit erreicht.' };
    return { ...base, shouldTurnOn: currentOn === true, action: currentOn ? 'KEEP_ON' : 'KEEP_OFF', reason: 'Maximale Tageslaufzeit erreicht; Mindestlaufzeit wird respektiert.' };
  }
  if (local.time >= settings.offAfterTime) {
    if (currentOn && (sinceChange === null || sinceChange >= settings.minRunMinutes)) return { ...base, shouldTurnOn: false, action: 'OFF', reason: `Abschaltzeit ${settings.offAfterTime} erreicht.` };
    return { ...base, shouldTurnOn: currentOn === true, action: currentOn ? 'KEEP_ON' : 'KEEP_OFF', reason: 'Abschaltzeit erreicht; Mindestlaufzeit wird respektiert.' };
  }

  const gridTooHigh = settings.maxGridImportKw !== null && solar?.gridImportKw !== null && solar?.gridImportKw !== undefined && solar.gridImportKw > settings.maxGridImportKw;
  const surplusTooLow = settings.lowSurplusThresholdKw !== null && solar?.pvSurplusKw !== null && solar?.pvSurplusKw !== undefined && solar.pvSurplusKw < settings.lowSurplusThresholdKw;
  if (currentOn && (gridTooHigh || surplusTooLow)) {
    const sustained = options.sustainedOffConditionMinutes ?? 0;
    if (sustained >= settings.offDelayMinutes && (sinceChange === null || sinceChange >= settings.minRunMinutes)) {
      return { ...base, shouldTurnOn: false, action: 'OFF', reason: gridTooHigh ? 'Netzbezug lag lang genug über dem Grenzwert.' : 'PV-Überschuss lag lang genug unter dem Grenzwert.' };
    }
    return { ...base, shouldTurnOn: true, action: 'KEEP_ON', reason: `Abschaltbedingung erkannt, Verzögerung ${sustained}/${settings.offDelayMinutes} Minuten.` };
  }

  if (passed) {
    if (currentOn) return { ...base, shouldTurnOn: true, action: 'KEEP_ON', reason: 'Regeln erfüllt; Wärmepumpe bleibt eingeschaltet.' };
    if (sinceChange !== null && sinceChange < settings.minOffMinutes) return { ...base, shouldTurnOn: false, action: 'KEEP_OFF', reason: `Mindestauszeit noch nicht erreicht (${sinceChange}/${settings.minOffMinutes} Min.).` };
    return { ...base, shouldTurnOn: true, action: 'ON', reason: 'Alle erforderlichen Automatikregeln sind erfüllt.' };
  }

  if (currentOn) {
    if (sinceChange !== null && sinceChange < settings.minRunMinutes) return { ...base, shouldTurnOn: true, action: 'KEEP_ON', reason: `Regeln nicht erfüllt, aber Mindestlaufzeit läuft noch (${sinceChange}/${settings.minRunMinutes} Min.).` };
    return { ...base, shouldTurnOn: false, action: 'OFF', reason: 'Automatikregeln sind nicht mehr erfüllt.' };
  }
  return { ...base, shouldTurnOn: false, action: 'KEEP_OFF', reason: 'Automatikregeln sind nicht erfüllt.' };
}
