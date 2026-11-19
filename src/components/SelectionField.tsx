'use client';

import { useId, type ReactNode } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { Translate } from '@/lib/types';
import { SelectionControl } from './SelectionDialog';
import s from './SelectionField.module.css';

export default function SelectionField<T extends string>({
  label,
  value,
  options,
  t,
  onSelect,
  disabled = false,
  searchLabel,
}: {
  label: string;
  value: T;
  options: readonly {
    value: T;
    en: string;
    th: string;
    descriptionEn?: string;
    descriptionTh?: string;
    icon?: ReactNode;
  }[];
  t: Translate;
  onSelect: (value: T) => void;
  disabled?: boolean;
  searchLabel?: string;
}) {
  const labelId = useId();
  const valueId = useId();
  const selected = options.find((option) => option.value === value);
  return (
    <div className={s.field}>
      <span id={labelId}>{label}</span>
      <SelectionControl
        title={label}
        value={value}
        options={options}
        t={t}
        onSelect={onSelect}
        deferSelection={false}
        searchLabel={searchLabel}
        trigger={(open, openDialog) => (
          <button
            type="button"
            className={s.trigger}
            aria-labelledby={`${labelId} ${valueId}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={disabled || options.length === 0}
            onClick={openDialog}
          >
            <span id={valueId} className={s.selectedValue}>
              {selected?.icon && <span aria-hidden="true">{selected.icon}</span>}
              {selected ? t(selected.en, selected.th) : t('Choose an option', 'เลือกตัวเลือก')}
            </span>
            {searchLabel ? (
              <Search size={16} aria-hidden="true" />
            ) : (
              <ChevronDown size={16} aria-hidden="true" />
            )}
          </button>
        )}
      />
    </div>
  );
}
