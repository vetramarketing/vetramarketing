import type { CustomerContact, CustomerContactType } from './types';

export const CONTACT_TYPES: readonly {
  value: CustomerContactType;
  en: string;
  th: string;
  icon: string | null;
}[] = [
  { value: 'facebook', en: 'Facebook', th: 'Facebook', icon: '/icons/Facebook.svg' },
  { value: 'line', en: 'Line', th: 'Line', icon: '/icons/LINE.svg' },
  { value: 'whatsapp', en: 'WhatsApp', th: 'WhatsApp', icon: '/icons/Whatsapp.svg' },
  { value: 'email', en: 'Email', th: 'อีเมล', icon: '/icons/Email.svg' },
  { value: 'instagram', en: 'Instagram', th: 'Instagram', icon: '/icons/IG.svg' },
  { value: 'phone', en: 'Phone Call', th: 'โทรศัพท์', icon: '/icons/Phone.svg' },
  { value: 'custom', en: 'Custom', th: 'กำหนดเอง', icon: null },
];

export function safeCustomerUrl(value: string): boolean {
  if (!value) return true;
  if (value.length > 2048 || value.trim() !== value || /[\u0000-\u0020\u007f\\]/.test(value))
    return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validCustomerEmail(value: string): boolean {
  return !value || (value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

/** Legacy labels are recognized without changing their saved text or link order. */
export function customerContactType(
  link: Pick<CustomerContact, 'label' | 'type'>,
): CustomerContactType {
  if (link.type) return link.type;
  const label = link.label.trim().toLocaleLowerCase();
  return (
    CONTACT_TYPES.find(
      (option) =>
        option.en.toLocaleLowerCase() === label || option.th.toLocaleLowerCase() === label,
    )?.value ?? 'custom'
  );
}

/** Derive a safe action URL without rewriting stored contact input. */
export function customerContactHref(link: Pick<CustomerContact, 'label' | 'type' | 'url'>): string {
  const value = link.url;
  if (
    !value ||
    value.trim() !== value ||
    value.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return '';
  // Existing HTTPS destinations remain usable even if their label is Email or Phone Call.
  if (safeCustomerUrl(value)) return value;
  const type = customerContactType(link);
  if (type === 'email') {
    const address = value.replace(/^mailto:/i, '');
    // A single address only: no query headers, encoded controls, recipients, or URI schemes.
    if (
      address &&
      validCustomerEmail(address) &&
      !/[\s?#%,;:<>"\\\[\]]/.test(address) &&
      !address.split('@')[1]?.includes('/')
    )
      return `mailto:${address}`;
  }
  if (type === 'phone') {
    const number = value.replace(/^tel:/i, '');
    if (!/^\+?[0-9][0-9(). -]*$/.test(number)) return '';
    const digits = number.replace(/[(). -]/g, '');
    if (/^\+?\d{3,15}$/.test(digits)) return `tel:${digits}`;
  }
  return '';
}

export function validCustomerContact(
  link: Pick<CustomerContact, 'label' | 'type' | 'url'>,
): boolean {
  return !link.url || !!customerContactHref(link);
}
