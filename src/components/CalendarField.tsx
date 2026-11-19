'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  X,
} from 'lucide-react';
import type { Translate } from '@/lib/types';
import {
  bangkokCalendarNow,
  calendarDayAllowed,
  calendarValue,
  calendarValueAllowed,
  daysInMonth,
  formatCalendarDate,
  parseCalendarValue,
  shiftCalendarMonth,
  type CalendarParts,
  type CalendarType,
} from '@/lib/calendar';
import s from './CalendarField.module.css';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  t: Translate;
  type?: CalendarType;
  required?: boolean;
  min?: string;
  max?: string;
  disabled?: boolean;
  describedBy?: string;
};

function utcDate(parts: CalendarParts) {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, 0, 0);
  return date;
}

function dateLabel(value: string, type: CalendarType) {
  const parts = parseCalendarValue(value, type);
  if (!parts) return value;
  const date = formatCalendarDate(calendarValue(parts, 'date'));
  return type === 'date'
    ? date
    : `${date} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export default function CalendarField({ type = 'date', ...props }: Props) {
  const { label, value, onChange, t, required, min, max, disabled, describedBy } = props;
  const labelId = useId();
  const valueId = useId();
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if ((!value && !required) || calendarValueAllowed(value, type, min, max)) setInvalid(false);
  }, [value, required, type, min, max]);
  return (
    <div className={s.field}>
      <span id={labelId}>{label}</span>
      <input
        className={s.nativeInput}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        min={min}
        max={max}
        disabled={disabled}
        step={type === 'datetime-local' ? 60 : 1}
        tabIndex={-1}
        aria-hidden="true"
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          const input = event.currentTarget;
          const firstInvalid = input.form?.querySelector(
            'input:invalid, select:invalid, textarea:invalid',
          );
          if (!firstInvalid || firstInvalid === input) setOpen(true);
        }}
      />
      <button
        type="button"
        className={s.trigger}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-describedby={describedBy}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span id={valueId} className={!value ? s.placeholder : undefined}>
          {value ? dateLabel(value, type) : t('Select date', 'เลือกวันที่')}
        </span>
        <CalendarDays size={18} aria-hidden="true" />
      </button>
      {open &&
        !disabled &&
        createPortal(
          <CalendarDialog
            {...props}
            type={type}
            onChange={(next) => {
              setInvalid(false);
              onChange(next);
            }}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </div>
  );
}

function CalendarDialog({
  label,
  value,
  onChange,
  t,
  type,
  required,
  min,
  max,
  onClose,
}: Props & {
  type: CalendarType;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const focusRequest = useRef(false);
  const titleId = useId();
  const summaryId = useId();
  const yearId = useId();
  const locale = t('en', 'th');
  const existing = parseCalendarValue(value, type);
  const today = bangkokCalendarNow('date');
  const now = parseCalendarValue(bangkokCalendarNow(type), type)!;
  let starting = existing ?? now;
  const minimum = min ? parseCalendarValue(min, type) : null;
  const maximum = max ? parseCalendarValue(max, type) : null;
  if (minimum && calendarValue(starting, type) < min!) starting = minimum;
  if (maximum && calendarValue(starting, type) > max!) starting = maximum;
  // Default only the picker draft; the form value changes when Apply is pressed.
  const initialSelection = existing ?? starting;
  const [selected, setSelected] = useState<CalendarParts | null>(initialSelection);
  const [view, setView] = useState(starting);
  const [yearText, setYearText] = useState(String(starting.year).padStart(4, '0'));
  const [hourText, setHourText] = useState(String(initialSelection.hour).padStart(2, '0'));
  const [minuteText, setMinuteText] = useState(String(initialSelection.minute).padStart(2, '0'));
  const [monthsOpen, setMonthsOpen] = useState(false);
  const [focusedDay, setFocusedDay] = useState(calendarValue(starting, 'date'));
  const yearValid = /^\d{1,4}$/.test(yearText) && Number(yearText) >= 1 && Number(yearText) <= 9999;
  const timeValid =
    type === 'date' ||
    (/^\d{1,2}$/.test(hourText) &&
      Number(hourText) <= 23 &&
      /^\d{1,2}$/.test(minuteText) &&
      Number(minuteText) <= 59);
  const candidate =
    selected && timeValid
      ? calendarValue(
          {
            ...selected,
            hour: type === 'date' ? 0 : Number(hourText),
            minute: type === 'date' ? 0 : Number(minuteText),
          },
          type,
        )
      : '';
  const allowed = !!candidate && yearValid && calendarValueAllowed(candidate, type, min, max);
  const monthName = (month: number) =>
    new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC', calendar: 'gregory' }).format(
      utcDate({ ...view, month, day: 1 }),
    );
  const monthAllowed = (parts: CalendarParts) =>
    Array.from({ length: daysInMonth(parts.year, parts.month) }, (_, index) => index + 1).some(
      (day) => calendarDayAllowed(calendarValue({ ...parts, day }, 'date'), type, min, max),
    );
  const previous = shiftCalendarMonth({ ...view, day: 1 }, -1);
  const next = shiftCalendarMonth({ ...view, day: 1 }, 1);
  const offset = utcDate({ ...view, day: 1 }).getUTCDay();
  const dayCount = daysInMonth(view.year, view.month);
  const weekCount = Math.ceil((offset + dayCount) / 7);
  const cells = Array.from({ length: weekCount * 7 }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= dayCount ? calendarValue({ ...view, day }, 'date') : '';
  });
  const focusableDay =
    cells.includes(focusedDay) && calendarDayAllowed(focusedDay, type, min, max)
      ? focusedDay
      : cells.find((day) => day && calendarDayAllowed(day, type, min, max));
  const chosenDay = selected ? calendarValue(selected, 'date') : '';

  useLayoutEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (element && !element.open) element.showModal();
    (
      element?.querySelector<HTMLButtonElement>('[data-day][tabindex="0"]') ??
      element?.querySelector<HTMLButtonElement>('button')
    )?.focus({ preventScroll: true });
    return () => {
      if (element?.open) element.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    if (!focusRequest.current) return;
    dialog.current?.querySelector<HTMLButtonElement>(`[data-day="${focusedDay}"]`)?.focus();
    focusRequest.current = false;
  }, [focusedDay, view.year, view.month, monthsOpen]);

  function dismiss() {
    if (dialog.current?.open) dialog.current.close();
    onClose();
  }
  function showMonth(parts: CalendarParts) {
    setView(parts);
    setYearText(String(parts.year).padStart(4, '0'));
  }
  function chooseDay(date: string) {
    const parts = parseCalendarValue(date, 'date');
    if (!parts || !calendarDayAllowed(date, type, min, max)) return;
    setSelected(parts);
    setFocusedDay(date);
    showMonth(parts);
    setMonthsOpen(false);
  }
  function dayKey(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const parts = parseCalendarValue(date, 'date')!;
    let target = parts;
    const weekDay = utcDate(parts).getUTCDay();
    const delta = (
      {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
        Home: -weekDay,
        End: 6 - weekDay,
      } as Record<string, number>
    )[event.key];
    if (delta !== undefined) {
      const nextDate = utcDate(parts);
      nextDate.setUTCDate(nextDate.getUTCDate() + delta);
      target = {
        ...parts,
        year: nextDate.getUTCFullYear(),
        month: nextDate.getUTCMonth() + 1,
        day: nextDate.getUTCDate(),
      };
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      target = shiftCalendarMonth(
        parts,
        (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1),
      );
    } else return;
    event.preventDefault();
    event.stopPropagation();
    const targetValue = calendarValue(target, 'date');
    if (!targetValue || !calendarDayAllowed(targetValue, type, min, max)) return;
    focusRequest.current = true;
    setFocusedDay(targetValue);
    showMonth(target);
  }

  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled):not([tabindex="-1"])',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
        event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          dismiss();
      }}
    >
      <header className={s.header}>
        <div>
          <span className={s.eyebrow}>{t('CALENDAR', 'ปฏิทิน')}</span>
          <h2 id={titleId}>{label}</h2>
        </div>
        <button
          type="button"
          className={s.iconButton}
          onClick={dismiss}
          aria-label={t('Close calendar', 'ปิดปฏิทิน')}
        >
          <X size={20} />
        </button>
      </header>
      <div className={s.content}>
        <span className={s.srOnly} aria-live="polite" aria-atomic="true">
          {String(view.month).padStart(2, '0')}/{String(view.year).padStart(4, '0')}
        </span>
        <div className={s.monthNavigation}>
          <button
            type="button"
            className={s.iconButton}
            aria-label={t('Previous month', 'เดือนก่อนหน้า')}
            disabled={
              calendarValue(previous, 'date') === calendarValue({ ...view, day: 1 }, 'date') ||
              !monthAllowed(previous)
            }
            onClick={() => showMonth(previous)}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            className={s.monthButton}
            aria-label={t('Choose month', 'เลือกเดือน')}
            aria-expanded={monthsOpen}
            onClick={() => setMonthsOpen(!monthsOpen)}
          >
            {monthName(view.month)}
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            className={s.iconButton}
            aria-label={t('Next month', 'เดือนถัดไป')}
            disabled={
              calendarValue(next, 'date') === calendarValue({ ...view, day: 1 }, 'date') ||
              !monthAllowed(next)
            }
            onClick={() => showMonth(next)}
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <div className={s.yearField}>
          <label htmlFor={yearId}>{t('Year', 'ปี ค.ศ.')}</label>
          <input
            id={yearId}
            type="number"
            inputMode="numeric"
            min={1}
            max={9999}
            step={1}
            value={yearText}
            aria-invalid={!yearValid || undefined}
            onChange={(event) => {
              const text = event.target.value;
              setYearText(text);
              if (/^\d{1,4}$/.test(text) && Number(text) > 0)
                setView((current) => ({ ...current, year: Number(text), day: 1 }));
            }}
            onBlur={() => {
              if (yearValid) setYearText(String(Number(yearText)).padStart(4, '0'));
            }}
          />
          <button
            type="button"
            className={s.todayButton}
            disabled={!calendarDayAllowed(today, type, min, max)}
            onClick={() => chooseDay(today)}
          >
            {t('Today', 'วันนี้')}
          </button>
        </div>
        {monthsOpen ? (
          <div className={s.monthGrid} aria-label={t('Months', 'เดือน')}>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
              <button
                type="button"
                key={month}
                className={s.monthOption}
                aria-pressed={view.month === month}
                disabled={!monthAllowed({ ...view, month, day: 1 })}
                onClick={() => {
                  const target = { ...view, month, day: 1 };
                  const firstDay = Array.from(
                    { length: daysInMonth(target.year, month) },
                    (_, index) => calendarValue({ ...target, day: index + 1 }, 'date'),
                  ).find((date) => calendarDayAllowed(date, type, min, max));
                  if (firstDay) {
                    focusRequest.current = true;
                    setFocusedDay(firstDay);
                  }
                  showMonth(target);
                  setMonthsOpen(false);
                }}
              >
                {monthName(month)}
              </button>
            ))}
          </div>
        ) : (
          <table
            className={s.calendar}
            role="grid"
            aria-label={`${String(view.month).padStart(2, '0')}/${String(view.year).padStart(4, '0')}`}
          >
            <thead>
              <tr>
                {t('Su,Mo,Tu,We,Th,Fr,Sa', 'อา.,จ.,อ.,พ.,พฤ.,ศ.,ส.')
                  .split(',')
                  .map((day) => (
                    <th key={day} scope="col">
                      {day}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: weekCount }, (_, row) => (
                <tr key={row}>
                  {cells.slice(row * 7, row * 7 + 7).map((date, column) => (
                    <td key={column} role="gridcell" aria-selected={!!date && chosenDay === date}>
                      {date && (
                        <button
                          type="button"
                          className={s.day}
                          data-day={date}
                          aria-label={dateLabel(date, 'date')}
                          aria-current={date === today ? 'date' : undefined}
                          tabIndex={focusableDay === date ? 0 : -1}
                          disabled={!calendarDayAllowed(date, type, min, max)}
                          onFocus={() => setFocusedDay(date)}
                          onKeyDown={(event) => dayKey(event, date)}
                          onClick={() => chooseDay(date)}
                        >
                          {Number(date.slice(-2))}
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {type === 'datetime-local' && (
          <section className={s.timeSection} aria-label={t('24-hour time', 'เวลาแบบ 24 ชั่วโมง')}>
            <div className={s.timeHeading}>
              <Clock3 size={18} />
              <span>{t('Time · 24-hour', 'เวลา · 24 ชั่วโมง')}</span>
            </div>
            <div className={s.timeFields}>
              <label>
                <span>{t('Hour', 'ชั่วโมง')}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={23}
                  step={1}
                  placeholder="00–23"
                  value={hourText}
                  onChange={(event) => setHourText(event.target.value)}
                  onBlur={() => {
                    if (/^\d{1,2}$/.test(hourText) && Number(hourText) <= 23)
                      setHourText(hourText.padStart(2, '0'));
                  }}
                />
              </label>
              <span className={s.colon} aria-hidden="true">
                :
              </span>
              <label>
                <span>{t('Minute', 'นาที')}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={59}
                  step={1}
                  placeholder="00–59"
                  value={minuteText}
                  onChange={(event) => setMinuteText(event.target.value)}
                  onBlur={() => {
                    if (/^\d{1,2}$/.test(minuteText) && Number(minuteText) <= 59)
                      setMinuteText(minuteText.padStart(2, '0'));
                  }}
                />
              </label>
            </div>
            <p className={s.hint}>{t('Bangkok time (UTC+7)', 'เวลากรุงเทพฯ (UTC+7)')}</p>
          </section>
        )}
        <div className={s.summary} id={summaryId} aria-live="polite">
          <CalendarDays size={18} aria-hidden="true" />
          <span>
            {candidate
              ? dateLabel(candidate, type)
              : selected
                ? dateLabel(chosenDay, 'date')
                : t('Select a date to continue', 'เลือกวันที่เพื่อดำเนินการต่อ')}
          </span>
        </div>
        {!yearValid && (
          <p className={s.error} role="status">
            {t('Enter a year from 1 to 9999.', 'กรอกปี ค.ศ. ตั้งแต่ 1 ถึง 9999')}
          </p>
        )}
        {type === 'datetime-local' && !timeValid && (hourText || minuteText) && (
          <p className={s.hint}>
            {t(
              'Enter an hour from 00–23 and a minute from 00–59.',
              'กรอกชั่วโมง 00–23 และนาที 00–59',
            )}
          </p>
        )}
        {(min || max) && (
          <p className={candidate && !allowed && yearValid ? s.error : s.hint}>
            {min && `${t('From', 'ตั้งแต่')} ${dateLabel(min, type)}`}
            {min && max && ' · '}
            {max && `${t('Until', 'ไม่เกิน')} ${dateLabel(max, type)}`}
          </p>
        )}
      </div>
      <footer className={s.footer}>
        {!required && (
          <button
            type="button"
            className={s.clearButton}
            onClick={() => {
              onChange('');
              dismiss();
            }}
          >
            {t('Clear', 'ล้างค่า')}
          </button>
        )}
        <div className={s.footerActions}>
          <button type="button" className={s.cancelButton} onClick={dismiss}>
            {t('Cancel', 'ยกเลิก')}
          </button>
          <button
            type="button"
            className={s.applyButton}
            disabled={!allowed}
            onClick={() => {
              if (allowed) {
                onChange(candidate);
                dismiss();
              }
            }}
          >
            <Check size={17} />
            {t('Apply', 'ใช้วันที่นี้')}
          </button>
        </div>
      </footer>
    </dialog>
  );
}
