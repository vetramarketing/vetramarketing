export type CalendarType = 'date' | 'datetime-local';

export type CalendarParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** Calendar arithmetic never converts a date-only value through the browser timezone. */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month)) return 0;
  if (month < 1 || month > 12) return 0;
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseCalendarValue(
  value: string,
  type: CalendarType = 'date',
): CalendarParts | null {
  const match =
    type === 'datetime-local'
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
      : /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || match[0] !== value) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
  };
  if (
    parts.day < 1 ||
    parts.day > daysInMonth(parts.year, parts.month) ||
    parts.hour > 23 ||
    parts.minute > 59
  )
    return null;
  return parts;
}

/** Formats a valid stored date-only value for display without timezone or locale shifts. */
export function formatCalendarDate(value: string): string {
  const parts = parseCalendarValue(value);
  return parts ? `${pad(parts.day)}/${pad(parts.month)}/${pad(parts.year, 4)}` : '';
}

/** Returns an empty string rather than serializing invalid calendar components. */
export function calendarValue(parts: CalendarParts, type: CalendarType = 'date'): string {
  if (
    !Number.isInteger(parts.day) ||
    parts.day < 1 ||
    parts.day > daysInMonth(parts.year, parts.month) ||
    !Number.isInteger(parts.hour) ||
    parts.hour < 0 ||
    parts.hour > 23 ||
    !Number.isInteger(parts.minute) ||
    parts.minute < 0 ||
    parts.minute > 59
  )
    return '';
  const date = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
  return type === 'datetime-local' ? `${date}T${pad(parts.hour)}:${pad(parts.minute)}` : date;
}

export function shiftCalendarMonth(parts: CalendarParts, delta: number): CalendarParts {
  if (!calendarValue(parts) || !Number.isFinite(delta) || !Number.isInteger(delta))
    throw new RangeError(
      'Month navigation requires valid calendar parts and a whole month offset.',
    );
  const index = Math.min(
    9999 * 12 - 1,
    Math.max(0, (parts.year - 1) * 12 + parts.month - 1 + delta),
  );
  const year = Math.floor(index / 12) + 1;
  const month = (index % 12) + 1;
  return { ...parts, year, month, day: Math.min(parts.day, daysInMonth(year, month)) };
}

/** Whole calendar years and months, then remaining days, without local-time or DST shifts. */
export function elapsedCalendarDuration(
  from: string,
  through: string,
): { years: number; months: number; days: number } | null {
  const start = parseCalendarValue(from);
  const end = parseCalendarValue(through);
  if (!start || !end || from > through) return null;
  let wholeMonths = (end.year - start.year) * 12 + end.month - start.month;
  let anniversary = shiftCalendarMonth(start, wholeMonths);
  if (calendarValue(anniversary) > through) anniversary = shiftCalendarMonth(start, --wholeMonths);
  const utcDay = (parts: CalendarParts) => {
    const date = new Date(0);
    date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
  };
  return {
    years: Math.floor(wholeMonths / 12),
    months: wholeMonths % 12,
    days: Math.round((utcDay(end) - utcDay(anniversary)) / 86_400_000),
  };
}

function validBounds(type: CalendarType, min?: string, max?: string): boolean {
  return (
    (!min || !!parseCalendarValue(min, type)) &&
    (!max || !!parseCalendarValue(max, type)) &&
    (!min || !max || min <= max)
  );
}

export function calendarValueAllowed(
  value: string,
  type: CalendarType,
  min?: string,
  max?: string,
): boolean {
  return (
    !!parseCalendarValue(value, type) &&
    validBounds(type, min, max) &&
    (!min || value >= min) &&
    (!max || value <= max)
  );
}

/** A datetime day is selectable when at least one of its minutes is within the range. */
export function calendarDayAllowed(
  date: string,
  type: CalendarType,
  min?: string,
  max?: string,
): boolean {
  if (!parseCalendarValue(date) || !validBounds(type, min, max)) return false;
  if (type === 'date') return calendarValueAllowed(date, type, min, max);
  return (!min || `${date}T23:59` >= min) && (!max || `${date}T00:00` <= max);
}

export function bangkokCalendarNow(type: CalendarType = 'date', now = new Date()): string {
  if (!Number.isFinite(now.getTime())) return '';
  const formatted = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
    timeZone: 'Asia/Bangkok',
    era: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  if (formatted.find((part) => part.type === 'era')?.value !== 'AD') return '';
  const part = (key: string) => Number(formatted.find((piece) => piece.type === key)?.value);
  return calendarValue(
    {
      year: part('year'),
      month: part('month'),
      day: part('day'),
      hour: part('hour'),
      minute: part('minute'),
    },
    type,
  );
}
