'use client';

import { shippingAddressLimits, type ShippingAddress } from '@/lib/shipping-address';
import type { Translate } from '@/lib/types';
import s from './OrdersPanel.module.css';

export default function OrderAddressFields({
  value,
  onChange,
  t,
  disabled = false,
  prefix,
}: {
  value: ShippingAddress;
  onChange: (value: ShippingAddress) => void;
  t: Translate;
  disabled?: boolean;
  prefix: string;
}) {
  const fields = [
    ['name', 'Full name', 'ชื่อผู้รับ', 'text', 'name'],
    ['phone', 'Phone', 'โทรศัพท์', 'tel', 'tel'],
    ['address', 'Street address', 'บ้านเลขที่ ถนน หมู่บ้าน', 'text', 'street-address'],
    ['subdistrict', 'Subdistrict', 'ตำบล / แขวง', 'text', 'address-level3'],
    ['district', 'District', 'อำเภอ / เขต', 'text', 'address-level2'],
    ['province', 'Province', 'จังหวัด', 'text', 'address-level1'],
    ['postalCode', 'Postal code', 'รหัสไปรษณีย์', 'text', 'postal-code'],
  ] as const;
  return (
    <div className={s.formGrid}>
      {fields.map(([key, en, th, type, autocomplete]) => (
        <label className={`${s.field} ${key === 'address' ? s.fullWidth : ''}`} key={key}>
          <span>{t(en, th)}</span>
          <input
            type={type}
            autoComplete={`section-recipient shipping ${autocomplete}`}
            aria-label={`${prefix} · ${t(en, th)}`}
            disabled={disabled}
            value={value[key]}
            maxLength={shippingAddressLimits[key]}
            inputMode={key === 'postalCode' ? 'numeric' : undefined}
            onChange={(event) => onChange({ ...value, [key]: event.target.value })}
          />
        </label>
      ))}
    </div>
  );
}
