import { describe, expect, it } from 'vitest';
import { evaluateAutomation } from '../src/automation';
import { DEFAULT_SETTINGS } from '../src/defaults';
import type { Settings, SolarSnapshot, WeatherSnapshot } from '../src/types';

const solar: SolarSnapshot = { fetchedAt: '2026-08-20T04:00:00Z', pvCurrentKw: 3.4, dailyEnergyKwh: 8, consumptionKw: 1.2, gridImportKw: 0, feedInKw: 2.2, batterySoc: 74, pvSurplusKw: 2.2, availableMetrics: ['pvCurrentKw','dailyEnergyKwh','consumptionKw','gridImportKw','feedInKw','batterySoc','pvSurplusKw'] };
const weather: WeatherSnapshot = { fetchedAt: '2026-08-20T04:00:00Z', date: '2026-08-20', temperatureC: 24, weatherCode: 1, sunshineHours: 7, cloudCoverPct: 20, shortwaveRadiationMj: 18, tiltedIrradiationKwhM2: 5, sunrise: '06:05', sunset: '20:15', pvForecastKwh: 18, solarCondition: 'GOOD' };
const settings = (changes: Partial<Settings> = {}): Settings => ({ ...structuredClone(DEFAULT_SETTINGS), automationEnabled: true, ...changes });

function evalWith(s: Settings, changes: Partial<Parameters<typeof evaluateAutomation>[0]> = {}) {
  return evaluateAutomation({ settings: s, solar, weather, currentOn: false, lastChangedAt: '2026-08-19T20:00:00Z', dailyRuntimeMinutes: 0, now: new Date('2026-08-20T04:00:00Z'), ...changes });
}

describe('automation', () => {
  it('turns on when AND rules pass at 06:00 Berlin', () => expect(evalWith(settings()).action).toBe('ON'));
  it('stays off before configured start time', () => expect(evalWith(settings({ checkTime: '06:15' })).action).toBe('KEEP_OFF'));
  it('fails safe when an enabled metric is missing', () => {
    const s = settings({ rules: [{ id:'x',label:'Batterie',metric:'batterySoc',operator:'>=',threshold:60,enabled:true }] });
    const result = evalWith(s, { solar: { ...solar, batterySoc: null } });
    expect(result.action).toBe('KEEP_OFF'); expect(result.reason).toContain('Fail-Safe');
  });
  it('supports OR rules', () => {
    const s = settings({ ruleJoiner:'OR', rules:[{id:'a',label:'Sonne',metric:'sunshineHours',operator:'>=',threshold:99,enabled:true},{id:'b',label:'Forecast',metric:'pvForecastKwh',operator:'>=',threshold:10,enabled:true}] });
    expect(evalWith(s).action).toBe('ON');
  });
  it('respects minimum off time', () => {
    const r = evalWith(settings({ minOffMinutes:30 }), { lastChangedAt:'2026-08-20T03:50:00Z' });
    expect(r.action).toBe('KEEP_OFF');
  });
  it('respects minimum run time before switching off', () => {
    const s=settings({ rules:[{id:'a',label:'Sonne',metric:'sunshineHours',operator:'>=',threshold:99,enabled:true}],minRunMinutes:45 });
    const r=evalWith(s,{currentOn:true,lastChangedAt:'2026-08-20T03:40:00Z'});
    expect(r.action).toBe('KEEP_ON');
  });
  it('stops after max daily runtime', () => {
    const r=evalWith(settings({maxDailyRuntimeMinutes:60}),{currentOn:true,lastChangedAt:'2026-08-20T02:00:00Z',dailyRuntimeMinutes:60});
    expect(r.action).toBe('OFF');
  });
  it('uses configured delay before low-surplus shutdown', () => {
    const s=settings({lowSurplusThresholdKw:1.5,offDelayMinutes:15,minRunMinutes:0});
    const early=evalWith(s,{currentOn:true,lastChangedAt:'2026-08-20T02:00:00Z',solar:{...solar,pvSurplusKw:0.4},sustainedOffConditionMinutes:10});
    const late=evalWith(s,{currentOn:true,lastChangedAt:'2026-08-20T02:00:00Z',solar:{...solar,pvSurplusKw:0.4},sustainedOffConditionMinutes:15});
    expect(early.action).toBe('KEEP_ON'); expect(late.action).toBe('OFF');
  });
  it('manual off overrides automation', () => expect(evalWith(settings({mode:'MANUAL_OFF'}),{currentOn:true}).action).toBe('OFF'));
  it('simulation never returns a real switch action', () => expect(evalWith(settings(),{simulation:true}).action).toBe('SIMULATE_ON'));
});
