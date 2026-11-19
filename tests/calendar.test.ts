import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bangkokCalendarNow,
  calendarDayAllowed,
  calendarValue,
  calendarValueAllowed,
  daysInMonth,
  elapsedCalendarDuration,
  formatCalendarDate,
  parseCalendarValue,
  shiftCalendarMonth,
} from '../src/lib/calendar';

test('Gregorian leap years and four-digit boundary years round-trip without timezone conversion', () => {
  for (const date of ['0001-01-01', '0099-12-31', '2000-02-29', '2024-02-29', '9999-12-31']) {
    const parts = parseCalendarValue(date);
    assert.ok(parts, date);
    assert.equal(calendarValue(parts), date);
    assert.equal(parts.hour, 0);
    assert.equal(parts.minute, 0);
  }
  assert.equal(daysInMonth(1900, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 12), 31);
  assert.equal(daysInMonth(2026, 13), 0);
  assert.equal(daysInMonth(0, 1), 0);
});

test('calendar dates display as zero-padded DD/MM/YYYY without changing stored values', () => {
  assert.equal(formatCalendarDate('2024-02-29'), '29/02/2024');
  assert.equal(formatCalendarDate('0001-01-01'), '01/01/0001');
  assert.equal(formatCalendarDate('0099-12-31'), '31/12/0099');
  assert.equal(formatCalendarDate('2025-02-29'), '');
  assert.equal(formatCalendarDate('2024-2-29'), '');
  assert.equal(formatCalendarDate(''), '');
});

test('invalid and incomplete calendar values are rejected instead of normalized into another day', () => {
  for (const value of [
    '',
    '0000-01-01',
    '10000-01-01',
    '2026-00-01',
    '2026-13-01',
    '2026-01-00',
    '2026-04-31',
    '1900-02-29',
    '2026-02-29',
    '2026-1-02',
    '2026-01-2',
    ' 2026-01-02',
    '2026-01-02T00:00',
  ]) {
    assert.equal(parseCalendarValue(value), null, value);
  }
  for (const value of [
    '2026-01-02',
    '2026-01-02T24:00',
    '2026-01-02T23:60',
    '2026-01-02T-1:00',
    '2026-01-02T1:00',
    '2026-01-02T12:00:00',
    '2026-01-02T12:00Z',
  ]) {
    assert.equal(parseCalendarValue(value, 'datetime-local'), null, value);
  }
  const parts = parseCalendarValue('2026-10-28T23:59', 'datetime-local')!;
  assert.equal(calendarValue(parts, 'datetime-local'), '2026-10-28T23:59');
  assert.equal(calendarValue({ ...parts, day: 32 }), '');
  assert.equal(calendarValue({ ...parts, hour: 24 }, 'datetime-local'), '');
  assert.equal(calendarValue({ ...parts, minute: 1.5 }, 'datetime-local'), '');
});

test('month navigation clamps short months and supported year boundaries while preserving time', () => {
  const parts = parseCalendarValue('2024-01-31T23:59', 'datetime-local')!;
  assert.equal(calendarValue(shiftCalendarMonth(parts, 1), 'datetime-local'), '2024-02-29T23:59');
  assert.equal(calendarValue(shiftCalendarMonth(parts, 13)), '2025-02-28');
  assert.equal(calendarValue(shiftCalendarMonth(parts, -1)), '2023-12-31');
  assert.equal(calendarValue(shiftCalendarMonth(parts, -1000000)), '0001-01-31');
  assert.equal(calendarValue(shiftCalendarMonth(parts, 1000000)), '9999-12-31');
  assert.equal(calendarValue(parts, 'datetime-local'), '2024-01-31T23:59');
  assert.throws(() => shiftCalendarMonth(parts, 0.5), RangeError);
});

test('date bounds are inclusive and invalid or reversed bounds fail closed', () => {
  assert.equal(calendarValueAllowed('2024-02-29', 'date', '2024-02-29', '2024-02-29'), true);
  assert.equal(calendarValueAllowed('2024-02-28', 'date', '2024-02-29'), false);
  assert.equal(calendarValueAllowed('2024-03-01', 'date', undefined, '2024-02-29'), false);
  assert.equal(calendarValueAllowed('2024-02-29', 'date', '', ''), true);
  assert.equal(calendarValueAllowed('', 'date'), false);
  assert.equal(calendarValueAllowed('2024-02-29', 'date', '2024-02-30'), false);
  assert.equal(calendarDayAllowed('2024-02-29', 'date', '2024-03-01', '2024-02-28'), false);
});

test('datetime days remain selectable when part of the day is allowed, but minutes obey bounds', () => {
  const min = '2026-10-28T10:15';
  const max = '2026-10-29T00:00';
  assert.equal(calendarDayAllowed('2026-10-27', 'datetime-local', min, max), false);
  assert.equal(calendarDayAllowed('2026-10-28', 'datetime-local', min, max), true);
  assert.equal(calendarDayAllowed('2026-10-29', 'datetime-local', min, max), true);
  assert.equal(calendarDayAllowed('2026-10-30', 'datetime-local', min, max), false);
  assert.equal(calendarValueAllowed('2026-10-28T10:14', 'datetime-local', min, max), false);
  assert.equal(calendarValueAllowed(min, 'datetime-local', min, max), true);
  assert.equal(calendarValueAllowed(max, 'datetime-local', min, max), true);
  assert.equal(calendarValueAllowed('2026-10-29T00:01', 'datetime-local', min, max), false);
  assert.equal(calendarDayAllowed('2026-10-28', 'datetime-local', max, min), false);
  assert.equal(calendarDayAllowed('2026-02-30', 'datetime-local'), false);
  assert.equal(calendarDayAllowed('2026-10-28', 'datetime-local', '2026-10-28'), false);
});

test('Bangkok current values cross UTC day and year boundaries using 00-23 hour time', () => {
  assert.equal(
    bangkokCalendarNow('datetime-local', new Date('2026-10-28T16:59:59Z')),
    '2026-10-28T23:59',
  );
  assert.equal(
    bangkokCalendarNow('datetime-local', new Date('2026-10-28T17:00:00Z')),
    '2026-10-29T00:00',
  );
  assert.equal(bangkokCalendarNow('date', new Date('2026-12-31T17:00:00Z')), '2027-01-01');
  assert.equal(
    bangkokCalendarNow('datetime-local', new Date('2024-02-28T17:01:00Z')),
    '2024-02-29T00:01',
  );
  assert.equal(bangkokCalendarNow('date', new Date(NaN)), '');
});

test('elapsed calendar years, months, and days handle leap days and month ends', () => {
  assert.deepEqual(elapsedCalendarDuration('2024-02-29', '2025-02-28'), {
    years: 1,
    months: 0,
    days: 0,
  });
  assert.deepEqual(elapsedCalendarDuration('2026-01-31', '2026-03-01'), {
    years: 0,
    months: 1,
    days: 1,
  });
  assert.deepEqual(elapsedCalendarDuration('2025-12-31', '2026-01-01'), {
    years: 0,
    months: 0,
    days: 1,
  });
  assert.deepEqual(elapsedCalendarDuration('2026-10-28', '2026-10-28'), {
    years: 0,
    months: 0,
    days: 0,
  });
  assert.deepEqual(elapsedCalendarDuration('0099-12-31', '0100-01-01'), {
    years: 0,
    months: 0,
    days: 1,
  });
  assert.equal(elapsedCalendarDuration('2026-10-29', '2026-10-28'), null);
  assert.equal(elapsedCalendarDuration('2026-02-29', '2026-10-28'), null);
});
