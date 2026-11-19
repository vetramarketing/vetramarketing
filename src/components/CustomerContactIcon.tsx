import { Link2 } from 'lucide-react';
import { CONTACT_TYPES } from '@/lib/customer-contacts';
import type { CustomerContactType } from '@/lib/types';
import s from './CustomerContactIcon.module.css';

export default function CustomerContactIcon({ type }: { type: CustomerContactType }) {
  const icon = CONTACT_TYPES.find((option) => option.value === type)?.icon;
  return icon ? (
    // The adjacent label or link's accessible name identifies the contact type.
    // eslint-disable-next-line @next/next/no-img-element
    <img className={s.icon} src={icon} alt="" width={28} height={28} />
  ) : (
    <Link2 className={s.icon} aria-hidden="true" />
  );
}
