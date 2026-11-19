import { formatCalendarDate } from './calendar';
import { CONTACT_TYPES, customerContactHref, customerContactType } from './customer-contacts';
import type { Customer, Workspace } from './types';
import type { CustomerPurchaseIndex } from './customer-purchases';

type CustomerSearchData = {
  [Key in 'customers' | 'companies' | 'businessTypes' | 'products']: Readonly<Workspace[Key]>;
} & { purchases?: CustomerPurchaseIndex };
const quantityFormatter = new Intl.NumberFormat('en-US');

/** Keep Thai vowel/tone marks; normalize equivalent Unicode and pasted spacing only. */
function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200b\ufeff]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function dateText(value: string | undefined): string {
  return value ? `${value} ${formatCalendarDate(value)}` : '';
}

function phoneDigits(value: string): string {
  const number = normalize(value).replace(/^tel:/, '');
  return /^\+?[\d(). -]+$/.test(number) ? number.replace(/\D/g, '') : '';
}

/** Index saved details, including retained fields from an earlier company or business type. */
export function buildCustomerSearchIndex(data: CustomerSearchData): Map<string, string> {
  const companies = new Map(data.companies.map((item) => [item.id, item]));
  const types = new Map(data.businessTypes.map((item) => [item.id, item]));
  const products = new Map(data.products.map((item) => [item.id, item]));
  const fields = new Map(
    data.businessTypes.flatMap((type) =>
      type.customerFields.map((field) => [field.id, field] as const),
    ),
  );
  const index = new Map<string, string>();

  for (const customer of data.customers) {
    if (customer.deletedAt) continue;
    const company = companies.get(customer.companyId);
    const type = company ? types.get(company.businessTypeId) : undefined;
    const purchase = data.purchases?.get(customer.id);
    const productIds = new Set([
      ...(customer.productIds ?? []),
      ...(purchase?.byProduct.keys() ?? []),
    ]);
    index.set(
      customer.id,
      normalize(
        [
          customer.id,
          customer.name,
          customer.organization,
          customer.contactName,
          customer.email,
          customer.phone,
          phoneDigits(customer.phone),
          ...Object.values(customer.recipient ?? {}),
          customer.recipient && phoneDigits(customer.recipient.phone),
          customer.website,
          customer.notes,
          company?.name,
          type?.name,
          type?.nameTh,
          customer.firstContactOn
            ? `first contact ติดต่อครั้งแรก ${dateText(customer.firstContactOn)}`
            : '',
          customer.lastContactOn
            ? `last contact ติดต่อล่าสุด ${dateText(customer.lastContactOn)}`
            : '',
          ...customer.socialLinks.flatMap((link) => {
            const type = customerContactType(link);
            const option = CONTACT_TYPES.find((item) => item.value === type);
            const href = customerContactHref(link);
            return [
              link.label,
              link.url,
              type,
              option?.en,
              option?.th,
              href,
              href.startsWith('tel:') ? phoneDigits(href) : '',
            ];
          }),
          purchase &&
            `purchased units ${purchase.total} จำนวนที่ซื้อ ${purchase.total} ${quantityFormatter.format(purchase.total)}`,
          ...Array.from(productIds).flatMap((id) => {
            const quantity = data.purchases
              ? purchase?.byProduct.get(id)
              : customer.productQuantities?.[id];
            return [
              products.get(id)?.name ?? purchase?.productNames.get(id),
              quantity == null
                ? ''
                : `purchased units ${quantity} จำนวนที่ซื้อ ${quantity} ${quantityFormatter.format(quantity)}`,
            ];
          }),
          ...customer.domains.flatMap((domain) => [
            'domain โดเมน',
            domain.domain,
            dateText(domain.expiresOn),
          ]),
          ...customer.githubAccounts.flatMap((account) => [
            account.name || account.email || account.username ? 'GitHub' : '',
            account.name,
            account.email,
            account.username,
            account.username ? `@${account.username.replace(/^@/, '')}` : '',
          ]),
          ...Object.entries(customer.fieldValues).flatMap(([id, value]) => {
            if (!value.trim()) return [];
            const field = fields.get(id);
            return [field?.label, value, field?.type === 'date' ? dateText(value) : ''];
          }),
        ]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join('\n'),
      ),
    );
  }
  return index;
}

/** Words can match separate fields. Phone punctuation is optional without rewriting records. */
export function createCustomerSearchMatcher(
  index: ReadonlyMap<string, string>,
  query: string,
): (customer: Customer) => boolean {
  const terms = normalize(query)
    .split(' ')
    .filter(Boolean)
    .map((term) => {
      const variants = [term];
      const digits = phoneDigits(term);
      if (digits) variants.push(digits);
      return variants;
    });
  return (customer) => {
    if (customer.deletedAt) return false;
    if (!terms.length) return true;
    const document = index.get(customer.id);
    return (
      document !== undefined &&
      terms.every((variants) => variants.some((term) => document.includes(term)))
    );
  };
}
