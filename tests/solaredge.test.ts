import { describe, expect, it } from 'vitest';
import { normalizeSolarEdge } from '../src/solaredge';

describe('SolarEdge normalization', () => {
  it('extracts production, load, export and battery', () => {
    const result = normalizeSolarEdge(
      { overview: { currentPower: { power: 3500 }, lastDayData: { energy: 12400 } } },
      { siteCurrentPowerFlow: { unit: 'kW', PV: { currentPower: 3.5 }, LOAD: { currentPower: 1.2 }, GRID: { currentPower: 2.3 }, STORAGE: { chargeLevel: 74 }, connections: [{ from: 'PV', to: 'Grid' }] } }
    );
    expect(result.pvCurrentKw).toBe(3.5);
    expect(result.dailyEnergyKwh).toBe(12.4);
    expect(result.feedInKw).toBe(2.3);
    expect(result.gridImportKw).toBeNull();
    expect(result.batterySoc).toBe(74);
    expect(result.pvSurplusKw).toBeCloseTo(2.3);
  });

  it('detects import direction', () => {
    const result = normalizeSolarEdge({}, { siteCurrentPowerFlow: { unit: 'kW', PV: { currentPower: 0.4 }, LOAD: { currentPower: 1.5 }, GRID: { currentPower: 1.1 }, connections: [{ from: 'GRID', to: 'Load' }] } });
    expect(result.gridImportKw).toBe(1.1);
    expect(result.feedInKw).toBeNull();
  });
});
