import type { MetricName, SolarSnapshot } from './types';

interface SolarEdgeOverviewResponse {
  overview?: {
    currentPower?: { power?: number };
    lastDayData?: { energy?: number };
  };
}

interface PowerNode { currentPower?: number; chargeLevel?: number; status?: string }
interface SolarEdgePowerFlowResponse {
  siteCurrentPowerFlow?: {
    unit?: string;
    PV?: PowerNode;
    LOAD?: PowerNode;
    GRID?: PowerNode;
    STORAGE?: PowerNode;
    connections?: Array<{ from?: string; to?: string }>;
  };
}

function toKw(value: number | undefined, unit = 'kW'): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const normalized = unit.toLowerCase();
  if (normalized === 'w') return value / 1000;
  if (normalized === 'mw') return value * 1000;
  return value;
}

export function normalizeSolarEdge(overviewData: SolarEdgeOverviewResponse, flowData: SolarEdgePowerFlowResponse, fetchedAt = new Date().toISOString()): SolarSnapshot {
  const flow = flowData.siteCurrentPowerFlow;
  const unit = flow?.unit ?? 'kW';
  const pvCurrentKw = toKw(flow?.PV?.currentPower, unit) ?? (typeof overviewData.overview?.currentPower?.power === 'number' ? overviewData.overview.currentPower.power / 1000 : null);
  const consumptionKw = toKw(flow?.LOAD?.currentPower, unit);
  const gridPowerKw = toKw(flow?.GRID?.currentPower, unit);
  let gridImportKw: number | null = null;
  let feedInKw: number | null = null;
  if (gridPowerKw !== null && flow?.connections) {
    const importing = flow.connections.some((connection) => connection.from === 'GRID' && connection.to === 'Load');
    const exporting = flow.connections.some((connection) => connection.from === 'PV' && connection.to === 'Grid') || flow.connections.some((connection) => connection.to === 'Grid');
    if (importing) gridImportKw = gridPowerKw;
    if (exporting && !importing) feedInKw = gridPowerKw;
  }
  if (gridPowerKw !== null && gridImportKw === null && feedInKw === null && pvCurrentKw !== null && consumptionKw !== null) {
    const balance = pvCurrentKw - consumptionKw;
    if (balance >= 0) feedInKw = gridPowerKw;
    else gridImportKw = gridPowerKw;
  }
  const dailyWh = overviewData.overview?.lastDayData?.energy;
  const dailyEnergyKwh = typeof dailyWh === 'number' && Number.isFinite(dailyWh) ? dailyWh / 1000 : null;
  const batterySoc = typeof flow?.STORAGE?.chargeLevel === 'number' ? flow.STORAGE.chargeLevel : null;
  const pvSurplusKw = pvCurrentKw !== null && consumptionKw !== null ? Math.max(0, pvCurrentKw - consumptionKw) : feedInKw;

  const values: Record<MetricName, number | null> = {
    pvCurrentKw, dailyEnergyKwh, consumptionKw, gridImportKw, feedInKw, batterySoc, pvSurplusKw,
    sunshineHours: null, cloudCoverPct: null, shortwaveRadiationMj: null, pvForecastKwh: null
  };
  const availableMetrics = (Object.entries(values) as Array<[MetricName, number | null]>)
    .filter(([, value]) => value !== null)
    .map(([name]) => name)
    .filter((name) => !['sunshineHours', 'cloudCoverPct', 'shortwaveRadiationMj', 'pvForecastKwh'].includes(name));

  return { fetchedAt, pvCurrentKw, dailyEnergyKwh, consumptionKw, gridImportKw, feedInKw, batterySoc, pvSurplusKw, availableMetrics };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`SolarEdge HTTP ${response.status}`);
  return response.json();
}

export async function fetchSolarEdge(siteId: string, apiKey: string): Promise<SolarSnapshot> {
  if (!/^\d+$/.test(siteId)) throw new Error('Ungültige SolarEdge Site-ID');
  if (apiKey.length < 10) throw new Error('SolarEdge API-Key fehlt oder ist ungültig');
  const base = 'https://monitoringapi.solaredge.com/site';
  const key = encodeURIComponent(apiKey);
  const [overview, flow] = await Promise.all([
    fetchJson(`${base}/${encodeURIComponent(siteId)}/overview?api_key=${key}`),
    fetchJson(`${base}/${encodeURIComponent(siteId)}/currentPowerFlow?api_key=${key}`)
  ]);
  return normalizeSolarEdge(overview as SolarEdgeOverviewResponse, flow as SolarEdgePowerFlowResponse);
}
