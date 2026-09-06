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

  it('diagnoses current SolarEdge V2 public endpoint shapes in CI', async () => {
    if (!process.env.CI) return;
    const candidates = [
      'https://api.solaredge.com/v2/oauth2/token',
      'https://api.solaredge.com/oauth2/token',
      'https://api.solaredge.com/v2/oauth/token',
      'https://api.solaredge.com/oauth/token'
    ];
    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'diagnostic-invalid-client', client_secret: 'diagnostic-invalid-secret' }),
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000)
        });
        const text = await response.text();
        const safe = text.slice(0, 160).replace(/[\r\n]+/g, ' ').replace(/diagnostic-invalid-[^\s"']+/g, '[redacted]');
        console.log(`SOLAREDGE_V2_PROBE ${url} -> ${response.status} ${response.headers.get('content-type') ?? ''} ${safe}`);
      } catch (error) {
        console.log(`SOLAREDGE_V2_PROBE ${url} -> NETWORK ${error instanceof Error ? error.name : 'unknown'}`);
      }
    }
    const sites = await fetch('https://api.solaredge.com/v2/sites', { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    console.log(`SOLAREDGE_V2_PROBE https://api.solaredge.com/v2/sites -> ${sites.status} ${sites.headers.get('content-type') ?? ''}`);
  }, 60_000);
});
