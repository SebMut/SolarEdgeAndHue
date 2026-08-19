import { describe, expect, it } from 'vitest';
import { partsInTimezone, startOfLocalDayIso } from '../src/time';

describe('Europe/Berlin time', () => {
  it('handles summer time', () => {
    const p = partsInTimezone(new Date('2026-08-20T04:00:00Z'), 'Europe/Berlin');
    expect(p.time).toBe('06:00');
  });
  it('handles winter time', () => {
    const p = partsInTimezone(new Date('2026-12-20T05:00:00Z'), 'Europe/Berlin');
    expect(p.time).toBe('06:00');
  });
  it('calculates local midnight UTC in summer', () => {
    expect(startOfLocalDayIso(new Date('2026-08-20T12:00:00Z'), 'Europe/Berlin')).toBe('2026-08-19T22:00:00.000Z');
  });
});
