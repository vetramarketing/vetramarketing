'use client';

import { startTransition, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import type { Translate } from '@/lib/types';
import s from './PostSortDialog.module.css';

export type SelectionTrigger = (open: boolean, openDialog: () => void) => ReactNode;

/** Keep open/close updates local so a large page does not render just to show a dialog. */
export function SelectionControl<T extends string>({
  title,
  options,
  value,
  t,
  onSelect,
  trigger,
  deferSelection = true,
  searchLabel,
}: {
  title: string;
  options: readonly {
    value: T;
    en: string;
    th: string;
    descriptionEn?: string;
    descriptionTh?: string;
    icon?: ReactNode;
  }[];
  value: T;
  t: Translate;
  onSelect: (value: T) => void;
  trigger: SelectionTrigger;
  deferSelection?: boolean;
  searchLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {trigger(open, () => setOpen(true))}
      {open && (
        <SelectionDialog
          title={title}
          options={options}
          value={value}
          t={t}
          onSelect={onSelect}
          deferSelection={deferSelection}
          searchLabel={searchLabel}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export default function SelectionDialog<T extends string>({
  title,
  options,
  value,
  t,
  onSelect,
  onClose,
  deferSelection,
  searchLabel,
}: {
  title: string;
  options: readonly {
    value: T;
    en: string;
    th: string;
    descriptionEn?: string;
    descriptionTh?: string;
    icon?: ReactNode;
  }[];
  value: T;
  t: Translate;
  onSelect: (value: T) => void;
  onClose: () => void;
  deferSelection: boolean;
  searchLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const visibleOptions = query
    ? options.filter((option) =>
        [option.en, option.th, option.descriptionEn, option.descriptionTh].some((text) =>
          text?.toLocaleLowerCase().includes(query),
        ),
      )
    : options;
  const titleId = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (element && !element.open) element.showModal();
    (
      searchRef.current ??
      element?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ??
      element?.querySelector<HTMLButtonElement>('button')
    )?.focus({ preventScroll: true });
    return () => {
      if (element?.open) element.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  function dismiss() {
    // Close the top-layer dialog immediately; the parent can update its list afterwards.
    if (dialog.current?.open) dialog.current.close();
    onClose();
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
            'button:not(:disabled), input:not(:disabled)',
          ),
        );
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
        <h2 id={titleId}>{title}</h2>
        <button type="button" className={s.close} onClick={dismiss} aria-label={t('Close', 'ปิด')}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      {searchLabel && (
        <input
          ref={searchRef}
          className={s.search}
          type="search"
          aria-label={searchLabel}
          placeholder={searchLabel}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
        />
      )}
      <div className={s.options}>
        {!visibleOptions.length && (
          <p role="status">{t('No matching results', 'ไม่พบผลลัพธ์ที่ตรงกัน')}</p>
        )}
        {visibleOptions.map((option) => (
          <button
            type="button"
            key={option.value}
            className={s.option}
            aria-pressed={value === option.value}
            onClick={() => {
              dismiss();
              if (option.value !== value) {
                if (deferSelection) startTransition(() => onSelect(option.value));
                else onSelect(option.value);
              }
            }}
          >
            {option.icon && (
              <span className={s.optionIcon} aria-hidden="true">
                {option.icon}
              </span>
            )}
            <span className={s.optionCopy}>
              <span>{t(option.en, option.th)}</span>
              {option.descriptionEn && option.descriptionTh && (
                <small>{t(option.descriptionEn, option.descriptionTh)}</small>
              )}
            </span>
            {value === option.value && <Check size={20} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </dialog>
  );
}
