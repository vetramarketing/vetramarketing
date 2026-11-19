export interface ShippingAddress {
  name: string;
  phone: string;
  address: string;
  subdistrict: string;
  district: string;
  province: string;
  postalCode: string;
}

export function emptyShippingAddress(): ShippingAddress {
  return {
    name: '',
    phone: '',
    address: '',
    subdistrict: '',
    district: '',
    province: '',
    postalCode: '',
  };
}

export const shippingAddressLimits: Record<keyof ShippingAddress, number> = {
  name: 200,
  phone: 40,
  address: 1000,
  subdistrict: 200,
  district: 200,
  province: 200,
  postalCode: 5,
};

export function validShippingPhone(value: string): boolean {
  return !value || (value.length <= shippingAddressLimits.phone && /^[+\d ()-]+$/.test(value));
}

export function validateShippingAddress(
  value: unknown,
  label = 'Shipping address',
): ShippingAddress {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  const source = value as Record<string, unknown>;
  const address = emptyShippingAddress();
  for (const key of Object.keys(address) as (keyof ShippingAddress)[]) {
    const entry = source[key];
    if (
      typeof entry !== 'string' ||
      entry.length > shippingAddressLimits[key] ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(entry)
    )
      throw new Error(`${label} ${key} is invalid.`);
    address[key] = entry;
  }
  if (!validShippingPhone(address.phone)) throw new Error(`${label} phone is invalid.`);
  if (address.postalCode && !/^\d{5}$/.test(address.postalCode))
    throw new Error(`${label} postal code must contain 5 digits.`);
  return address;
}
