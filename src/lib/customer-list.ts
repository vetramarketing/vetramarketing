import { elapsedCalendarDuration } from './calendar';
import { CONTACT_TYPES, customerContactHref, customerContactType } from './customer-contacts';
import { buildCustomerSearchIndex, createCustomerSearchMatcher } from './customer-search';
import type { CustomerPurchaseIndex, CustomerPurchases } from './customer-purchases';
import type { BusinessType, Company, Customer, Product } from './types';

export type CustomerSort =
  | 'name-asc'
  | 'name-desc'
  | 'products-asc'
  | 'products-desc'
  | 'units-highest'
  | 'units-lowest'
  | 'last-newest'
  | 'last-oldest'
  | 'first-longest'
  | 'first-shortest'
  | 'contact-asc'
  | 'contact-desc';
export type LastContactFilter = 'all' | 'recent' | 'earlier' | 'missing' | 'recorded';

export interface CustomerListOptions {
  companyId: string;
  productId: string;
  search: string;
  today: string;
  locale: string;
  sort: CustomerSort;
  lastContactFilter: LastContactFilter;
  companies: readonly Company[];
  businessTypes: readonly BusinessType[];
  products: readonly Product[];
  purchases?: CustomerPurchaseIndex;
  customersWithUnrecordedUnits?: ReadonlySet<string>;
  /** The UI can reuse its index until customer/catalog data changes. */
  searchIndex?: ReadonlyMap<string, string>;
}

export function customerPurchasedUnits(
  customer: Customer,
  productId: string,
  purchase: CustomerPurchases | undefined,
  customersWithUnrecordedUnits?: ReadonlySet<string>,
): number | undefined {
  const recorded = productId === 'all' ? purchase?.total : purchase?.byProduct.get(productId);
  return (
    recorded ??
    (customersWithUnrecordedUnits?.has(`${customer.companyId}:${customer.id}`) ? undefined : 0)
  );
}

export function visibleCustomerProductIds(
  customer: Customer,
  productId: string,
  purchase: CustomerPurchases | undefined,
): string[] {
  return [
    ...new Set([...(customer.productIds ?? []), ...(purchase?.byProduct.keys() ?? [])]),
  ].filter((id) => productId === 'all' || id === productId);
}

/** Current screens supply the order index. Older callers can still read pre-migration counts. */
export function recordedPurchasedUnits(
  customers: readonly Customer[],
  productId: string,
  purchases?: CustomerPurchaseIndex,
): number {
  let total = 0;
  for (const customer of customers) {
    if (customer.deletedAt) continue;
    if (purchases) {
      const purchase = purchases.get(customer.id);
      total += (productId === 'all' ? purchase?.total : purchase?.byProduct.get(productId)) ?? 0;
      continue;
    }
    for (const id of customer.productIds ?? []) {
      if (productId !== 'all' && id !== productId) continue;
      total += customer.productQuantities?.[id] ?? 0;
    }
  }
  return total;
}

function daysBefore(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day - days);
  utc.setUTCHours(0, 0, 0, 0);
  return utc.toISOString().slice(0, 10);
}

/** Keep unknown dates last unless the selected sort explicitly puts them first. */
function compareDates(a: string, b: string, direction: 1 | -1, unknownFirst = false): number {
  if (!a) return b ? (unknownFirst ? -1 : 1) : 0;
  if (!b) return unknownFirst ? 1 : -1;
  return a === b ? 0 : a < b ? -direction : direction;
}

/** Select the visible customer rows without changing workspace or input order. */
export function selectCustomers(
  customers: readonly Customer[],
  options: CustomerListOptions,
): Customer[] {
  const {
    companyId,
    productId,
    search,
    today,
    locale,
    sort,
    lastContactFilter,
    companies,
    businessTypes,
    products,
  } = options;
  const searchIndex =
    options.searchIndex ??
    buildCustomerSearchIndex({
      customers,
      companies,
      businessTypes,
      products,
      purchases: options.purchases,
    });
  const matchesSearch = createCustomerSearchMatcher(searchIndex, search);
  const recentStart = daysBefore(today, 29);
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  // Calendar validation is independent of the comparison partner. Evaluate it
  // once per customer rather than repeating calendar arithmetic O(n log n) times.
  const firstDates = new Map<Customer, string>();
  const firstDate = (customer: Customer) => {
    let value = firstDates.get(customer);
    if (value === undefined) {
      value =
        customer.firstContactOn && elapsedCalendarDuration(customer.firstContactOn, today)
          ? customer.firstContactOn
          : '';
      firstDates.set(customer, value);
    }
    return value;
  };
  const byName = (a: Customer, b: Customer) =>
    collator.compare(a.name, b.name) || a.id.localeCompare(b.id);

  const visible = customers
    .filter(
      (customer) =>
        !customer.deletedAt && (companyId === 'all' || customer.companyId === companyId),
    )
    .filter(
      (customer) =>
        productId === 'all' ||
        customer.productIds?.includes(productId) ||
        options.purchases?.get(customer.id)?.byProduct.has(productId),
    )
    .filter(matchesSearch)
    .filter((customer) => {
      const last = customer.lastContactOn;
      switch (lastContactFilter) {
        case 'recent':
          return !!last && last >= recentStart && last <= today;
        case 'earlier':
          return !!last && last < recentStart;
        case 'missing':
          return !last;
        case 'recorded':
          return !!last;
        default:
          return true;
      }
    });
  if (sort === 'units-highest' || sort === 'units-lowest') {
    const units = new Map(
      visible.map((customer) => [
        customer,
        options.purchases
          ? customerPurchasedUnits(
              customer,
              productId,
              options.purchases.get(customer.id),
              options.customersWithUnrecordedUnits,
            )
          : recordedPurchasedUnits([customer], productId),
      ]),
    );
    const direction = sort === 'units-highest' ? -1 : 1;
    return visible.sort((a, b) => {
      const left = units.get(a);
      const right = units.get(b);
      if (left === undefined || right === undefined)
        return Number(left === undefined) - Number(right === undefined) || byName(a, b);
      return (left - right) * direction || byName(a, b);
    });
  }
  if (
    sort === 'products-asc' ||
    sort === 'products-desc' ||
    sort === 'contact-asc' ||
    sort === 'contact-desc'
  ) {
    const productNames = new Map(products.map((product) => [product.id, product.name]));
    const labels = new Map(
      visible.map((customer) => {
        if (sort === 'products-asc' || sort === 'products-desc') {
          const purchase = options.purchases?.get(customer.id);
          for (const id of visibleCustomerProductIds(customer, productId, purchase)) {
            const name = productNames.get(id) ?? purchase?.productNames.get(id);
            if (name) return [customer, name] as const;
          }
          return [customer, ''] as const;
        }
        const link = customer.socialLinks.find(customerContactHref);
        if (!link) return [customer, ''] as const;
        const type = customerContactType(link);
        const label = CONTACT_TYPES.find((option) => option.value === type);
        return [
          customer,
          (type === 'custom' ? link.label : '') || (locale === 'th' ? label?.th : label?.en) || '',
        ] as const;
      }),
    );
    const direction = sort === 'products-asc' || sort === 'contact-asc' ? 1 : -1;
    return visible.sort((a, b) => {
      const left = labels.get(a) ?? '';
      const right = labels.get(b) ?? '';
      if (!left || !right) return Number(!left) - Number(!right) || byName(a, b);
      return collator.compare(left, right) * direction || byName(a, b);
    });
  }
  return visible.sort((a, b) => {
    let order = 0;
    switch (sort) {
      case 'name-desc':
        order = -collator.compare(a.name, b.name);
        break;
      case 'last-newest':
        order = compareDates(a.lastContactOn, b.lastContactOn, -1, true);
        break;
      case 'last-oldest':
        order = compareDates(a.lastContactOn, b.lastContactOn, 1);
        break;
      case 'first-longest':
        order = compareDates(firstDate(a), firstDate(b), 1);
        break;
      case 'first-shortest':
        order = compareDates(firstDate(a), firstDate(b), -1);
        break;
      case 'name-asc':
        break;
    }
    return order || byName(a, b);
  });
}
