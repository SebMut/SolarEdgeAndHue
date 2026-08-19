export function partsInTimezone(date: Date, timeZone: string): { date: string; time: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const dateText = `${parts.year}-${parts.month}-${parts.day}`;
  const timeText = `${parts.hour}:${parts.minute}`;
  return { date: dateText, time: timeText, hour: Number(parts.hour), minute: Number(parts.minute) };
}

export function shouldRunDaily(now: Date, timeZone: string, configuredTime: string, alreadyRanDate: string | null): boolean {
  const local = partsInTimezone(now, timeZone);
  return local.time === configuredTime && local.date !== alreadyRanDate;
}

export function minutesSince(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now.getTime() - then) / 60_000));
}

export function startOfLocalDayIso(now: Date, timeZone: string): string {
  const local = partsInTimezone(now, timeZone);
  const [year, month, day] = local.date.split('-').map(Number);
  const guess = new Date(Date.UTC(year!, month! - 1, day!, 0, 0, 0));
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  const zoneName = formatter.formatToParts(guess).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const match = zoneName.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetMinutes = match ? (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  return new Date(guess.getTime() - offsetMinutes * 60_000).toISOString();
}
