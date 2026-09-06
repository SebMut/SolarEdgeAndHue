import { describe, expect, it } from 'vitest';
import { buildSolarEdgeAuthorizationUrl, normalizeSolarEdgeV2, parseSolarEdgeSites } from '../src/solaredge';

describe('SolarEdge ONE API V2', () => {
  it('parses authorized sites from common V2 response envelopes', () => {
    const sites = parseSolarEdgeSites({ sites: { list: [{ siteId: 12345, name: 'Pooldach', status: 'ACTIVE' }] } });
    expect(sites).toEqual([{ id: '12345', name: 'Pooldach', status: 'ACTIVE' }]);
  });

  it('normalizes live power, grid flow, battery and daily energy', () => {
    const result = normalizeSolarEdgeV2(
      {
        power: {
          production: { value: 4200, unit: 'W' },
          consumption: { value: 1300, unit: 'W' },
          grid: {
            import: { value: 100, unit: 'W' },
            export: { value: 3000, unit: 'W' }
          },
          storage: { soc: { value: 0.74 } }
        }
      },
      { production: { energy: { value: 12.4, unit: 'kWh' } } }
    );
    expect(result.pvCurrentKw).toBe(4.2);
    expect(result.consumptionKw).toBe(1.3);
    expect(result.gridImportKw).toBe(0.1);
    expect(result.feedInKw).toBe(3);
    expect(result.batterySoc).toBe(74);
    expect(result.dailyEnergyKwh).toBe(12.4);
    expect(result.pvSurplusKw).toBeCloseTo(2.9);
  });

  it('keeps unavailable metrics null instead of inventing values', () => {
    const result = normalizeSolarEdgeV2({ production: { power: { value: 2.1, unit: 'kW' } } });
    expect(result.pvCurrentKw).toBe(2.1);
    expect(result.batterySoc).toBeNull();
    expect(result.gridImportKw).toBeNull();
  });

  it('builds an OAuth authorization URL with state and callback', () => {
    const url = new URL(buildSolarEdgeAuthorizationUrl(
      { authorizationUrl: 'https://example.test/oauth/authorize', tokenUrl: 'https://example.test/oauth/token' },
      'client-123',
      'https://pool.example/oauth/solaredge/callback',
      'state-abc'
    ));
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe('https://pool.example/oauth/solaredge/callback');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});
