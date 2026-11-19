'use client';

import {
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  Github,
  Globe2,
  Hourglass,
  Link2,
  ListFilter,
  MessageCircle,
  MapPin,
  History,
  Package,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShoppingBasket,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { sortCatalog } from '@/lib/catalog';
import { bangkokCalendarNow, elapsedCalendarDuration, formatCalendarDate } from '@/lib/calendar';
import { buildCustomerPurchaseIndex, countsPurchasedUnits } from '@/lib/customer-purchases';
import { prepareCustomerQuantityOrderItems } from '@/lib/customer-orders';
import { MAX_ORDER_QUANTITY } from '@/lib/orders';
import CustomerOrdersDialog from './CustomerOrdersDialog';
import { productCompanyIdMap } from '@/lib/product-company';
import { buildCustomerSearchIndex } from '@/lib/customer-search';
import {
  customerPurchasedUnits,
  recordedPurchasedUnits,
  selectCustomers,
  visibleCustomerProductIds,
  type CustomerSort,
  type LastContactFilter,
} from '@/lib/customer-list';
import {
  CONTACT_TYPES,
  customerContactHref,
  customerContactType,
  validCustomerContact,
} from '@/lib/customer-contacts';
import {
  newCustomer,
  safeCustomerUrl,
  validCustomerDate,
  validCustomerDomain,
  validCustomerEmail,
} from '@/lib/customer-data';
import { recipientForCustomer } from '@/lib/order-customer';
import { validShippingPhone } from '@/lib/shipping-address';
import { validateWorkspace } from '@/lib/data';
import { entityEditIsCurrent } from '@/lib/entity-edit';
import type { Customer, Translate, Workspace } from '@/lib/types';
import BusinessTypeManager from './BusinessTypeManager';
import s from './CustomersPanel.module.css';
import list from './WorkspaceList.module.css';
import TableColumnHeading from './TableColumnHeading';
import post from './PostEditor.module.css';
import SelectionField from './SelectionField';
import { SelectionControl } from './SelectionDialog';
import CalendarField from './CalendarField';
import OrderAddressFields from './OrderAddressFields';
import { orderErrorMessage } from './order-ui';
import CustomerContactIcon from './CustomerContactIcon';
import CustomerProductField, { ProductThumbnail } from './CustomerProductField';

const defaultSocialTypes = ['facebook', 'line', 'email', 'phone', 'custom'] as const;
const maxSocialLinks = 100;

interface Props {
  data: Workspace;
  companyId: string;
  update: (next: Workspace) => Promise<boolean>;
  t: Translate;
  notify: (message: string) => void;
  openCustomerId?: string | null;
  onOpenHandled?: () => void;
}

const customerSortOptions = [
  { value: 'name-asc', en: 'Name A–Z', th: 'ชื่อ ก–ฮ' },
  { value: 'name-desc', en: 'Name Z–A', th: 'ชื่อ ฮ–ก' },
  { value: 'products-asc', en: 'Products A–Z', th: 'สินค้า ก–ฮ' },
  { value: 'products-desc', en: 'Products Z–A', th: 'สินค้า ฮ–ก' },
  { value: 'units-highest', en: 'Units: highest first', th: 'จำนวนชิ้น: มากไปน้อย' },
  { value: 'units-lowest', en: 'Units: lowest first', th: 'จำนวนชิ้น: น้อยไปมาก' },
  { value: 'last-newest', en: 'Last contact: newest', th: 'ติดต่อล่าสุด: ใหม่ก่อน' },
  { value: 'last-oldest', en: 'Last contact: oldest', th: 'ติดต่อล่าสุด: เก่าก่อน' },
  {
    value: 'first-longest',
    en: 'Time since first contact: longest',
    th: 'ระยะเวลาติดต่อ: นานที่สุด',
  },
  {
    value: 'first-shortest',
    en: 'Time since first contact: shortest',
    th: 'ระยะเวลาติดต่อ: สั้นที่สุด',
  },
  { value: 'contact-asc', en: 'Contact type A–Z', th: 'ช่องทางติดต่อ ก–ฮ' },
  { value: 'contact-desc', en: 'Contact type Z–A', th: 'ช่องทางติดต่อ ฮ–ก' },
] as const;

const lastContactFilterOptions = [
  { value: 'all', en: 'All last contacts', th: 'ติดต่อล่าสุดทั้งหมด' },
  { value: 'recent', en: 'Last 30 days', th: 'ภายใน 30 วันที่ผ่านมา' },
  { value: 'earlier', en: 'Earlier than 30 days', th: 'ก่อนช่วง 30 วันล่าสุด' },
  { value: 'recorded', en: 'Date recorded', th: 'มีวันที่ติดต่อ' },
  { value: 'missing', en: 'No date recorded', th: 'ไม่มีวันที่ติดต่อ' },
] as const;

export default function CustomersPanel({
  data,
  companyId,
  update,
  t,
  notify,
  openCustomerId,
  onOpenHandled,
}: Props) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const searchPending = query !== deferredQuery;
  const searchInput = useRef<HTMLInputElement>(null);
  const searchHelpId = useId();
  const listTitleId = useId();
  const [productId, setProductId] = useState('all');
  const [sort, setSort] = useState<CustomerSort>('last-newest');
  const [lastContactFilter, setLastContactFilter] = useState<LastContactFilter>('all');
  const [bangkokToday, setBangkokToday] = useState(bangkokCalendarNow);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [history, setHistory] = useState<{ customerId: string; productId?: string } | null>(null);
  const [typesOpen, setTypesOpen] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const handledOpenId = useRef<string | null>(null);
  const products = useMemo(
    () => new Map(data.products.map((item) => [item.id, item])),
    [data.products],
  );
  const purchases = useMemo(
    () => buildCustomerPurchaseIndex(data.orders ?? [], data.customers),
    [data.orders, data.customers],
  );
  const customersWithUnrecordedUnits = useMemo(() => {
    const customers = new Set<string>();
    for (const order of data.orders ?? []) {
      if (order.customerId && !order.items.length && countsPurchasedUnits(order))
        customers.add(`${order.companyId}:${order.customerId}`);
    }
    return customers;
  }, [data.orders]);
  const productOptions = useMemo(() => {
    const productCompanies = productCompanyIdMap(data.products, data.posts);
    const linkedIds = new Set<string>();
    const archivedProducts = new Map<string, string>();
    for (const customer of data.customers) {
      if (customer.deletedAt || (companyId !== 'all' && companyId !== customer.companyId)) continue;
      for (const id of customer.productIds ?? []) linkedIds.add(id);
      for (const [id, name] of purchases.get(customer.id)?.productNames ?? []) {
        linkedIds.add(id);
        if (!products.has(id)) archivedProducts.set(id, name);
      }
    }
    return [
      { value: 'all', en: 'All products', th: 'ทุกสินค้า' },
      ...sortCatalog(
        data.products.filter(
          (product) =>
            linkedIds.has(product.id) ||
            (!product.deletedAt &&
              (companyId === 'all' || productCompanies.get(product.id)?.includes(companyId))),
        ),
      ).map((product) => {
        const moved = companyId !== 'all' && !productCompanies.get(product.id)?.includes(companyId);
        return {
          value: product.id,
          en: product.name,
          th: product.name,
          ...(product.deletedAt
            ? { descriptionEn: 'In Trash', descriptionTh: 'อยู่ในถังขยะ' }
            : moved
              ? {
                  descriptionEn: 'Saved association · another company',
                  descriptionTh: 'ความสัมพันธ์ที่บันทึกไว้ · บริษัทอื่น',
                }
              : {}),
        };
      }),
      ...Array.from(archivedProducts, ([value, name]) => ({
        value,
        en: name,
        th: name,
        descriptionEn: 'From order history',
        descriptionTh: 'จากประวัติออเดอร์',
      })),
    ];
  }, [data.products, data.posts, data.customers, companyId, purchases, products]);
  const selectedProduct =
    productOptions.find((option) => option.value === productId) ?? productOptions[0];
  const searchIndex = useMemo(
    () =>
      buildCustomerSearchIndex({
        purchases,
        customers: data.customers,
        companies: data.companies,
        businessTypes: data.businessTypes,
        products: data.products,
      }),
    [data.customers, data.companies, data.businessTypes, data.products, purchases],
  );
  const locale = t('en', 'th');
  const visible = useMemo(
    () =>
      selectCustomers(data.customers, {
        companyId,
        productId,
        search: deferredQuery,
        today: bangkokToday,
        locale,
        sort,
        lastContactFilter,
        companies: data.companies,
        businessTypes: data.businessTypes,
        products: data.products,
        searchIndex,
        purchases,
        customersWithUnrecordedUnits,
      }),
    [
      data.customers,
      data.companies,
      data.businessTypes,
      data.products,
      companyId,
      productId,
      deferredQuery,
      bangkokToday,
      locale,
      sort,
      lastContactFilter,
      searchIndex,
      purchases,
      customersWithUnrecordedUnits,
    ],
  );
  const recordedUnits = useMemo(
    () => recordedPurchasedUnits(visible, productId, purchases),
    [visible, productId, purchases],
  );
  const filtersActive =
    !!deferredQuery.trim() || productId !== 'all' || lastContactFilter !== 'all';
  const selectedSort = customerSortOptions.find((option) => option.value === sort)!;
  const selectedLastContact = lastContactFilterOptions.find(
    (option) => option.value === lastContactFilter,
  )!;

  function headingSort(
    ascending: CustomerSort,
    descending: CustomerSort,
    first: CustomerSort = ascending,
  ) {
    const next = sort === ascending ? descending : sort === descending ? ascending : first;
    const option = customerSortOptions.find(({ value }) => value === next)!;
    return {
      direction:
        sort === ascending
          ? ('ascending' as const)
          : sort === descending
            ? ('descending' as const)
            : undefined,
      nextLabel: t(`Sort by ${option.en}`, `เรียงตาม ${option.th}`),
      onClick: () => setSort(next),
    };
  }

  useEffect(() => {
    const timer = window.setInterval(() => setBangkokToday(bangkokCalendarNow()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (productId !== 'all' && !productOptions.some((option) => option.value === productId)) {
      setProductId('all');
    }
  }, [productId, productOptions]);

  useEffect(() => {
    if (!openCustomerId) {
      handledOpenId.current = null;
      return;
    }
    if (handledOpenId.current === openCustomerId) return;
    handledOpenId.current = openCustomerId;
    const customer = data.customers.find((item) => item.id === openCustomerId && !item.deletedAt);
    if (customer) setEditing(structuredClone(customer));
    else
      notify(
        t(
          'This customer is no longer available. Any open edits have been preserved.',
          'ไม่พบลูกค้ารายนี้แล้ว การแก้ไขที่เปิดอยู่ยังคงถูกเก็บไว้',
        ),
      );
    onOpenHandled?.();
  }, [openCustomerId, data.customers, onOpenHandled, notify, t]);

  function closeEditor() {
    setEditing(null);
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) addRef.current?.focus();
    });
  }

  // Keep urgent input and drawer state changes from rebuilding every customer row.
  const customerRows = useMemo(
    () =>
      visible.map((customer) => {
        const firstContact = customer.socialLinks[0];
        const contactUrl = firstContact ? customerContactHref(firstContact) : '';
        const externalContact = /^https:/i.test(contactUrl);
        const lastContact = formatCalendarDate(customer.lastContactOn);
        const elapsed = customer.firstContactOn
          ? elapsedCalendarDuration(customer.firstContactOn, bangkokToday)
          : null;
        const purchase = purchases.get(customer.id);
        const units = customerPurchasedUnits(
          customer,
          productId,
          purchase,
          customersWithUnrecordedUnits,
        );
        const linkedProducts = visibleCustomerProductIds(customer, productId, purchase).flatMap(
          (id) => {
            const product = products.get(id);
            const name = purchase?.productNames.get(id);
            return product
              ? [product]
              : name
                ? [{ id, name, imageUrl: '', sortOrder: 0, deletedAt: undefined }]
                : [];
          },
        );
        const contactLinks = customer.socialLinks.flatMap((link) => {
          const href = customerContactHref(link);
          return href ? [{ link, href }] : [];
        });
        return (
          <tr key={customer.id} className={contactUrl ? s.linkedRow : undefined}>
            <th scope="row" className={s.nameCell}>
              <div className={s.nameContent}>
                <button
                  type="button"
                  className={s.editButton}
                  aria-label={`${t('Edit customer', 'แก้ไขข้อมูลลูกค้า')} — ${customer.name}`}
                  title={t('Edit customer', 'แก้ไขข้อมูลลูกค้า')}
                  onClick={() => setEditing(structuredClone(customer))}
                >
                  <Pencil size={15} aria-hidden="true" />
                </button>
                {contactUrl ? (
                  <a
                    className={s.contactLink}
                    href={contactUrl}
                    target={externalContact ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    aria-label={`${customer.name} — ${externalContact ? t('Open first contact link (new tab)', 'เปิดลิงก์ติดต่อแรก (แท็บใหม่)') : t('Open first contact', 'เปิดช่องทางติดต่อแรก')}`}
                  >
                    <span className={s.customerName} title={customer.name}>
                      {customer.name}
                    </span>
                  </a>
                ) : (
                  <span className={s.customerName} title={customer.name}>
                    {customer.name}
                  </span>
                )}
              </div>
            </th>
            <td className={s.productsCell} data-label={t('Products', 'สินค้า')}>
              {linkedProducts.length ? (
                <ul className={s.productList}>
                  {linkedProducts.map((product) => (
                    <li key={product.id}>
                      <ProductThumbnail product={product} />
                      <span>
                        {linkedProducts.length > 1 && !product.deletedAt ? (
                          <button
                            type="button"
                            className={s.productOrderLink}
                            aria-haspopup="dialog"
                            aria-label={t(
                              `Orders for ${customer.name} · ${product.name}`,
                              `ออเดอร์ของ ${customer.name} · ${product.name}`,
                            )}
                            onClick={() =>
                              setHistory({ customerId: customer.id, productId: product.id })
                            }
                          >
                            <span className={s.productName}>{product.name}</span>
                          </button>
                        ) : (
                          <span className={s.productName} title={product.name}>
                            {product.name}
                          </span>
                        )}
                        {product.deletedAt && <small>{t('In Trash', 'อยู่ในถังขยะ')}</small>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                '-'
              )}
            </td>
            <td className={s.quantityCell} data-label={t('Orders', 'ออเดอร์')}>
              <button
                type="button"
                className={s.ordersTrigger}
                aria-haspopup="dialog"
                aria-label={t(
                  `Order history for ${customer.name}${units === undefined ? '' : ` · ${units} units`}`,
                  `ประวัติออเดอร์ของ ${customer.name}${units === undefined ? '' : ` · ${units} ชิ้น`}`,
                )}
                onClick={() =>
                  setHistory({
                    customerId: customer.id,
                    productId: productId === 'all' ? undefined : productId,
                  })
                }
              >
                {units?.toLocaleString('en-US') ?? '–'}
              </button>
            </td>
            <td className={s.lastContactCell} data-label={t('Last contact', 'ติดต่อล่าสุด')}>
              {lastContact ? <time dateTime={customer.lastContactOn}>{lastContact}</time> : '-'}
            </td>
            <td
              className={s.elapsedCell}
              data-label={t('Time since first contact', 'ระยะเวลาตั้งแต่ติดต่อครั้งแรก')}
            >
              {elapsed ? `${elapsed.years}Y${elapsed.months}M${elapsed.days}D` : '–'}
            </td>
            <td className={s.contactCell} data-label={t('Contact', 'ติดต่อ')}>
              {contactLinks.length ? (
                <div className={s.contactLinks}>
                  {contactLinks.map(({ link, href }) => {
                    const external = /^https:/i.test(href);
                    const type = customerContactType(link);
                    const option = CONTACT_TYPES.find((item) => item.value === type)!;
                    const label =
                      type === 'custom'
                        ? link.label || t('Custom link', 'ลิงก์อื่น')
                        : t(option.en, option.th);
                    return (
                      <a
                        key={link.id}
                        href={href}
                        className={s.socialLink}
                        target={external ? '_blank' : undefined}
                        rel="noopener noreferrer"
                        aria-label={`${label} — ${customer.name}${external ? t(' (new tab)', ' (แท็บใหม่)') : ''}`}
                        title={label}
                      >
                        <CustomerContactIcon type={type} />
                      </a>
                    );
                  })}
                </div>
              ) : (
                '-'
              )}
            </td>
          </tr>
        );
      }),
    [visible, products, purchases, customersWithUnrecordedUnits, productId, t, bangkokToday],
  );

  return (
    <div className={s.page}>
      <section className={list.panel} aria-labelledby={listTitleId}>
        <div className={`${s.toolbar} ${list.header}`}>
          <h1 id={listTitleId} className={list.title}>
            {t('Customers', 'ลูกค้า')} ·{' '}
            {searchPending ? '…' : visible.length.toLocaleString('en-US')}
          </h1>
          <div className={`${s.toolbarActions} ${list.actions}`}>
            <button
              type="button"
              className={`${s.secondaryButton} ${list.action}`}
              onClick={() => setTypesOpen(true)}
            >
              <Settings2 size={18} />
              {t('Business types', 'ประเภทธุรกิจ')}
            </button>
            <button
              ref={addRef}
              type="button"
              className={`${s.primaryButton} ${list.action} ${list.primaryAction}`}
              onClick={() => setEditing('new')}
              disabled={!data.companies.length}
            >
              <Plus size={19} />
              {t('Add customer', 'เพิ่มลูกค้า')}
            </button>
          </div>
        </div>
        <div
          className={s.summary}
          aria-label={t('Customer summary', 'สรุปข้อมูลลูกค้า')}
          aria-busy={searchPending}
        >
          <div className={s.summaryCard}>
            <span className={s.summaryIcon} aria-hidden="true">
              <UsersRound size={21} />
            </span>
            <div>
              <span className={s.summaryLabel}>{t('Customers', 'ลูกค้า')}</span>
              <strong>{visible.length.toLocaleString('en-US')}</strong>
            </div>
          </div>
          <div className={s.summaryCard}>
            <span className={s.summaryIcon} aria-hidden="true">
              <ShoppingBasket size={21} />
            </span>
            <div>
              <span className={s.summaryLabel}>{t('Units', 'จำนวนชิ้น')}</span>
              <strong>{recordedUnits.toLocaleString('en-US')}</strong>
            </div>
          </div>
        </div>
        <div className={`${s.filters} ${list.filters}`}>
          <div className={`${s.searchControl} ${list.searchControl}`}>
            <div className={`${s.search} ${list.search}`}>
              <Search size={19} aria-hidden="true" />
              <input
                ref={searchInput}
                type="search"
                aria-label={t('Search customers', 'ค้นหาลูกค้า')}
                aria-describedby={searchHelpId}
                title={t(
                  'Search names, contacts, products, companies, dates, domains, GitHub, notes, or custom details',
                  'ค้นหาชื่อ ช่องทางติดต่อ สินค้า บริษัท วันที่ โดเมน GitHub หมายเหตุ หรือข้อมูลเพิ่มเติม',
                )}
                placeholder={t(
                  'Search names, contacts, products, dates…',
                  'ค้นหาชื่อ ช่องทางติดต่อ สินค้า วันที่…',
                )}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && !event.nativeEvent.isComposing && query) {
                    event.preventDefault();
                    setQuery('');
                  }
                }}
                autoComplete="off"
                spellCheck={false}
              />
              <span className={s.searchCount} role="status" aria-live="polite" aria-atomic="true">
                {searchPending ? (
                  <>
                    <span aria-hidden="true">…</span>
                    <span className={s.srOnly}>
                      {t('Updating customers…', 'กำลังอัปเดตรายชื่อลูกค้า…')}
                    </span>
                  </>
                ) : (
                  <>
                    {visible.length.toLocaleString('en-US')}
                    <span className={s.srOnly}> {t('matching customers', 'ลูกค้าที่ตรงกัน')}</span>
                  </>
                )}
              </span>
              {query && (
                <button
                  type="button"
                  className={`${s.clearSearch} ${list.clearSearch}`}
                  aria-label={t('Clear customer search', 'ล้างคำค้นหาลูกค้า')}
                  onClick={() => {
                    setQuery('');
                    searchInput.current?.focus();
                  }}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              )}
            </div>
            <p id={searchHelpId} className={`${s.searchHelp} ${list.searchHelp}`}>
              {t(
                'Combine words in any order. Dates: DD/MM/YYYY. Current filters still apply.',
                'ใช้คำค้นร่วมกันได้โดยไม่ต้องเรียงลำดับ วันที่: DD/MM/YYYY โดยยังใช้ตัวกรองที่เลือกไว้',
              )}
            </p>
          </div>
          <div className={`${s.filterControls} ${list.filterControls}`}>
            <SelectionControl
              title={t('Select product', 'เลือกสินค้า')}
              options={productOptions}
              value={productId}
              t={t}
              onSelect={setProductId}
              trigger={(open, openDialog) => (
                <button
                  type="button"
                  className={`${s.filterButton} ${list.filterButton}`}
                  data-active={productId !== 'all'}
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  aria-label={`${t('Select product', 'เลือกสินค้า')}: ${t(selectedProduct.en, selectedProduct.th)}`}
                  onClick={openDialog}
                >
                  <Package size={18} aria-hidden="true" />
                  <span>{t(selectedProduct.en, selectedProduct.th)}</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              )}
            />
            <SelectionControl
              title={t('Filter by last contact', 'กรองตามวันที่ติดต่อล่าสุด')}
              options={lastContactFilterOptions}
              value={lastContactFilter}
              t={t}
              onSelect={setLastContactFilter}
              trigger={(open, openDialog) => (
                <button
                  type="button"
                  className={`${s.filterButton} ${list.filterButton}`}
                  data-active={lastContactFilter !== 'all'}
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  aria-label={`${t('Filter by last contact', 'กรองตามวันที่ติดต่อล่าสุด')}: ${t(selectedLastContact.en, selectedLastContact.th)}`}
                  onClick={openDialog}
                >
                  <CalendarClock size={18} aria-hidden="true" />
                  <span>{t(selectedLastContact.en, selectedLastContact.th)}</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              )}
            />
            <SelectionControl
              title={t('Sort customers', 'เรียงลำดับลูกค้า')}
              options={customerSortOptions}
              value={sort}
              t={t}
              onSelect={setSort}
              trigger={(open, openDialog) => (
                <button
                  type="button"
                  className={`${s.filterButton} ${list.filterButton}`}
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  aria-label={`${t('Sort customers', 'เรียงลำดับลูกค้า')}: ${t(selectedSort.en, selectedSort.th)}`}
                  onClick={openDialog}
                >
                  <ArrowDownUp size={18} aria-hidden="true" />
                  <span>{t(selectedSort.en, selectedSort.th)}</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              )}
            />
          </div>
        </div>
        <div className={s.results} aria-busy={searchPending}>
          {visible.length ? (
            <div
              className={s.tableContainer}
              role="region"
              aria-label={t('Customer list', 'รายชื่อลูกค้า')}
              tabIndex={0}
            >
              <table className={s.customerTable} aria-label={t('Customers', 'ลูกค้า')}>
                <thead>
                  <tr>
                    <TableColumnHeading
                      className={s.nameHeading}
                      label={t('Name', 'ชื่อ')}
                      icon={UserRound}
                      sort={headingSort('name-asc', 'name-desc')}
                    />
                    <TableColumnHeading
                      className={s.productsHeading}
                      label={t('Products', 'สินค้า')}
                      icon={Package}
                      sort={headingSort('products-asc', 'products-desc')}
                    />
                    <TableColumnHeading
                      className={s.quantityHeading}
                      label={t('Orders', 'ออเดอร์')}
                      icon={ShoppingBasket}
                      sort={headingSort('units-lowest', 'units-highest', 'units-highest')}
                    />
                    <TableColumnHeading
                      className={s.lastContactHeading}
                      label={t('Last contact', 'ติดต่อล่าสุด')}
                      icon={CalendarClock}
                      sort={headingSort('last-oldest', 'last-newest', 'last-newest')}
                    />
                    <TableColumnHeading
                      className={s.elapsedHeading}
                      label={t('Time since first contact', 'ระยะเวลาตั้งแต่ติดต่อครั้งแรก')}
                      icon={Hourglass}
                      sort={headingSort('first-shortest', 'first-longest', 'first-longest')}
                    />
                    <TableColumnHeading
                      className={s.contactsHeading}
                      label={t('Contact', 'ติดต่อ')}
                      icon={Link2}
                      sort={headingSort('contact-asc', 'contact-desc')}
                    />
                  </tr>
                </thead>
                <tbody>{customerRows}</tbody>
              </table>
            </div>
          ) : (
            <div className={s.empty}>
              <span>
                <UsersRound size={32} />
              </span>
              <h3>
                {filtersActive
                  ? t('No matching customers', 'ไม่พบลูกค้าที่ตรงกัน')
                  : t('Make room for your first customer', 'เริ่มเก็บข้อมูลลูกค้ารายแรก')}
              </h3>
              <p>
                {filtersActive
                  ? t('Try another search or change the filters.', 'ลองค้นหาใหม่หรือเปลี่ยนตัวกรอง')
                  : t(
                      'Add a customer to keep their contact details and business records together.',
                      'เพิ่มลูกค้าเพื่อเก็บข้อมูลติดต่อและรายละเอียดธุรกิจไว้ด้วยกัน',
                    )}
              </p>
              {filtersActive && (
                <button
                  className={s.secondaryButton}
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setProductId('all');
                    setLastContactFilter('all');
                  }}
                >
                  {t('Clear filters', 'ล้างตัวกรอง')}
                </button>
              )}
            </div>
          )}
        </div>
        <div className={list.footer}>
          <span>
            {searchPending
              ? t('Updating customers…', 'กำลังอัปเดตรายชื่อลูกค้า…')
              : t(
                  `${visible.length} ${visible.length === 1 ? 'customer' : 'customers'} in this view`,
                  `${visible.length} ลูกค้าในมุมมองนี้`,
                )}
          </span>
          <span>{t('Saved in workspace', 'บันทึกในพื้นที่ทำงาน')}</span>
        </div>
      </section>
      {history && (
        <CustomerOrdersDialog
          key={`orders:${history.customerId}`}
          data={data}
          customerId={history.customerId}
          totalUnits={purchases.get(history.customerId)?.total}
          productId={history.productId}
          update={update}
          notify={notify}
          t={t}
          onClose={() => setHistory(null)}
        />
      )}
      {editing && (
        <CustomerEditor
          key={editing === 'new' ? 'new' : `customer:${editing.id}`}
          data={data}
          customer={editing === 'new' ? undefined : editing}
          defaultCompanyId={
            companyId === 'all' ? (sortCatalog(data.companies)[0]?.id ?? '') : companyId
          }
          update={update}
          t={t}
          notify={notify}
          onOpenOrders={(customerId) => setHistory({ customerId })}
          onClose={closeEditor}
        />
      )}
      {typesOpen && (
        <BusinessTypeManager
          data={data}
          update={update}
          t={t}
          notify={notify}
          onClose={() => setTypesOpen(false)}
        />
      )}
    </div>
  );
}

function CustomerEditor({
  data,
  customer,
  defaultCompanyId,
  update,
  t,
  notify,
  onOpenOrders,
  onClose,
}: Omit<Props, 'companyId' | 'openCustomerId' | 'onOpenHandled'> & {
  customer?: Customer;
  onOpenOrders: (customerId: string) => void;
  defaultCompanyId: string;
  onClose: () => void;
}) {
  const [initial] = useState(() => {
    const editable = customer ? structuredClone(customer) : newCustomer(defaultCompanyId);
    const savedTypes = new Set(editable.socialLinks.map(customerContactType));
    for (const type of defaultSocialTypes) {
      if (editable.socialLinks.length >= maxSocialLinks) break;
      if (savedTypes.has(type)) continue;
      editable.socialLinks.push({
        id: crypto.randomUUID(),
        type,
        label: type === 'custom' ? '' : CONTACT_TYPES.find((option) => option.value === type)!.en,
        url: '',
      });
    }
    return editable;
  });
  const [draft, setDraft] = useState<Customer>(() => structuredClone(initial));
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [bangkokToday, setBangkokToday] = useState(() => bangkokCalendarNow());
  const [baseline] = useState(() => (customer ? structuredClone(customer) : null));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const confirming = discardOpen || deleteOpen;
  const safeActionRef = useRef<HTMLButtonElement>(null);
  const confirmActionRef = useRef<HTMLButtonElement>(null);
  const lastEditingFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const busyRef = useRef(false);
  const closingRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const confirmationTitleId = useId();
  const confirmationDescriptionId = useId();
  const company = data.companies.find((item) => item.id === draft.companyId);
  const type = data.businessTypes.find((item) => item.id === company?.businessTypeId);
  const socialEnabled = type?.customerSections.includes('social');
  const hasSocialDetails =
    !!baseline?.socialLinks.length || draft.socialLinks.some(({ url }) => url.trim());
  const productCompanies = useMemo(
    () => productCompanyIdMap(data.products, data.posts),
    [data.products, data.posts],
  );
  const availableProductIds = useMemo(
    () =>
      data.products
        .filter(
          (product) =>
            !product.deletedAt && productCompanies.get(product.id)?.includes(draft.companyId),
        )
        .map((product) => product.id),
    [data.products, productCompanies, draft.companyId],
  );
  const fieldDefinitions = useMemo(
    () =>
      new Map(
        data.businessTypes.flatMap((businessType) =>
          businessType.customerFields.map((field) => [field.id, { field, businessType }] as const),
        ),
      ),
    [data.businessTypes],
  );
  const activeFieldIds = new Set(
    type?.customerFields.filter((field) => !field.archived).map((field) => field.id) ?? [],
  );
  const retainedFields = Object.entries(draft.fieldValues)
    .filter(([id]) => !activeFieldIds.has(id))
    .map(([id, value]) => {
      const definition = fieldDefinitions.get(id);
      return {
        field: definition?.field ?? {
          id,
          label: t('Saved detail', 'ข้อมูลที่บันทึกไว้'),
          type: 'text' as const,
        },
        value,
        businessType: definition?.businessType,
      };
    });
  const orderLines = customer
    ? []
    : (draft.productIds ?? []).flatMap((productId) => {
        const value = Object.hasOwn(quantities, productId) ? quantities[productId].trim() : '';
        return value ? [{ productId, quantity: /^\d+$/.test(value) ? Number(value) : NaN }] : [];
      });
  const hasOrder = orderLines.length > 0;
  const dirty = hasOrder || JSON.stringify(initial) !== JSON.stringify(draft);
  const elapsed = draft.firstContactOn
    ? elapsedCalendarDuration(draft.firstContactOn, bangkokToday)
    : null;
  useEffect(() => {
    const timer = window.setInterval(() => setBangkokToday(bangkokCalendarNow()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useLayoutEffect(() => {
    const element = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (element && !element.open) element.showModal();
    nameRef.current?.focus({ preventScroll: true });
    return () => {
      if (element?.open) element.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    if (confirming) {
      restoreFocus.current = true;
      safeActionRef.current?.focus({ preventScroll: true });
    } else if (restoreFocus.current) {
      (lastEditingFocus.current ?? nameRef.current)?.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
  }, [confirming]);
  function finishClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    dialogRef.current?.close();
    onClose();
  }
  function cancelConfirmation() {
    if (busyRef.current) return;
    setDiscardOpen(false);
    setDeleteOpen(false);
    setError('');
  }
  function requestClose() {
    if (busyRef.current || closingRef.current || discardOpen) return;
    if (deleteOpen) {
      cancelConfirmation();
      return;
    }
    if (dirty) setDiscardOpen(true);
    else finishClose();
  }
  function setField<K extends keyof Customer>(key: K, value: Customer[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function checkDraft(candidate: Customer): string {
    if (!candidate.name.trim() || !data.companies.some((item) => item.id === candidate.companyId))
      return t(
        'Enter a customer name and choose your company.',
        'กรอกชื่อลูกค้าและเลือกบริษัทของคุณ',
      );
    if (
      !validCustomerEmail(candidate.email) ||
      candidate.githubAccounts.some((account) => !validCustomerEmail(account.email))
    )
      return t('Enter a valid email address or leave it blank.', 'กรอกอีเมลที่ถูกต้องหรือเว้นว่าง');
    if (!safeCustomerUrl(candidate.website))
      return t(
        'Use a complete HTTPS link for the website.',
        'ใช้ลิงก์ HTTPS แบบเต็มสำหรับเว็บไซต์',
      );
    if (candidate.recipient && !validShippingPhone(candidate.recipient.phone))
      return t('Enter a valid recipient phone number.', 'กรอกเบอร์โทรศัพท์ผู้รับให้ถูกต้อง');
    if (candidate.recipient?.postalCode && !/^\d{5}$/.test(candidate.recipient.postalCode))
      return t('Enter a five-digit recipient postal code.', 'กรอกรหัสไปรษณีย์ผู้รับ 5 หลัก');
    if (candidate.socialLinks.some((link) => !validCustomerContact(link)))
      return t(
        'Check the contact links. Use HTTPS for social links, an email address for Email, or a phone number for Phone Call.',
        'ตรวจสอบช่องทางติดต่อ ใช้ HTTPS สำหรับโซเชียล อีเมลสำหรับ Email หรือเบอร์โทรศัพท์สำหรับโทรออก',
      );
    if (!validCustomerDate(candidate.lastContactOn))
      return t(
        'Choose a valid last chat / contact date.',
        'เลือกวันที่แชต / ติดต่อล่าสุดที่ถูกต้อง',
      );
    if (
      !validCustomerDate(candidate.firstContactOn ?? '') ||
      (candidate.firstContactOn && candidate.firstContactOn > bangkokCalendarNow())
    )
      return t(
        'Choose a valid first contact date no later than today.',
        'เลือกวันที่ติดต่อครั้งแรกให้ถูกต้องและไม่เกินวันนี้',
      );
    if (
      candidate.domains.some(
        (domain) =>
          !domain.domain ||
          !validCustomerDomain(domain.domain) ||
          !validCustomerDate(domain.expiresOn),
      )
    )
      return t(
        'Enter a domain without https:// or a path, and check its expiry date.',
        'กรอกโดเมนโดยไม่ใส่ https:// หรือพาธ และตรวจสอบวันหมดอายุ',
      );
    const fields = data.businessTypes.flatMap((item) => item.customerFields);
    for (const field of fields) {
      const value = candidate.fieldValues[field.id] ?? '';
      if (
        (field.type === 'email' && !validCustomerEmail(value)) ||
        (field.type === 'url' && !safeCustomerUrl(value)) ||
        (field.type === 'date' && !validCustomerDate(value))
      )
        return t(`Check the value for ${field.label}.`, `ตรวจสอบข้อมูล ${field.label}`);
    }
    return '';
  }
  async function save(deleting = false) {
    if (busyRef.current || closingRef.current || discardOpen || deleting !== deleteOpen) return;
    const current = data.customers.find((item) => item.id === draft.id);
    if (!entityEditIsCurrent(baseline, current)) {
      setError(
        t(
          'This customer changed in another tab. Your edits are still here; reopen the latest record before saving.',
          'ลูกค้ารายนี้ถูกแก้ไขในแท็บอื่น การแก้ไขของคุณยังอยู่ โปรดเปิดข้อมูลล่าสุดก่อนบันทึก',
        ),
      );
      return;
    }
    const now = new Date(Math.max(Date.now(), Date.parse(draft.createdAt))).toISOString();
    const candidate: Customer =
      deleting && current
        ? { ...current, deletedAt: now, updatedAt: now }
        : {
            ...draft,
            name: draft.name.trim(),
            organization: draft.organization.trim(),
            contactName: draft.contactName.trim(),
            email: draft.email.trim(),
            phone: draft.phone.trim(),
            website: draft.website.trim(),
            notes: draft.notes.trim(),
            socialLinks: draft.socialLinks
              .map((link) => ({ ...link, label: link.label.trim(), url: link.url.trim() }))
              .filter(({ url }) => url),
            domains: draft.domains
              .map((domain) => ({
                ...domain,
                domain: domain.domain.trim().toLocaleLowerCase(),
                expiresOn: domain.expiresOn,
              }))
              .filter((domain) => domain.domain || domain.expiresOn),
            githubAccounts: draft.githubAccounts
              .map((account) => ({
                ...account,
                name: account.name.trim(),
                email: account.email.trim(),
                username: account.username.trim(),
              }))
              .filter((account) => account.name || account.email || account.username),
            updatedAt: now,
          };
    if (!deleting) {
      const message = checkDraft(candidate);
      if (message) {
        setError(message);
        return;
      }
    }
    if (
      orderLines.some(
        ({ quantity }) =>
          !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_ORDER_QUANTITY,
      )
    ) {
      setError(
        t(
          'Enter a whole number from 1 to 1,000,000 for each ordered product.',
          'กรอกจำนวนเต็มตั้งแต่ 1 ถึง 1,000,000 สำหรับสินค้าแต่ละรายการที่สั่ง',
        ),
      );
      return;
    }
    let next = {
      ...data,
      customers: current
        ? data.customers.map((item) => (item.id === candidate.id ? candidate : item))
        : [...data.customers, candidate],
    };
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      validateWorkspace(next);
      if (hasOrder) {
        try {
          next = prepareCustomerQuantityOrderItems(next, candidate.id, orderLines, new Date(now));
        } catch (cause) {
          setError(orderErrorMessage(cause, t));
          return;
        }
      }
      if (!(await update(next))) {
        setError(
          t(
            'Could not save. Your edits are still here. Review the workspace message and try again.',
            'บันทึกไม่สำเร็จ การแก้ไขของคุณยังอยู่ โปรดตรวจสอบข้อความพื้นที่ทำงานแล้วลองอีกครั้ง',
          ),
        );
        return;
      }
      notify(
        deleting
          ? t(
              'Customer moved to Trash. Restore it within 30 days.',
              'ย้ายลูกค้าไปถังขยะแล้ว กู้คืนได้ภายใน 30 วัน',
            )
          : hasOrder
            ? t('Customer and order saved.', 'บันทึกลูกค้าและออเดอร์แล้ว')
            : t('Customer saved.', 'บันทึกข้อมูลลูกค้าแล้ว'),
      );
      finishClose();
    } catch {
      setError(
        t(
          'Could not save this customer. Check the fields and try again. Your edits are still here.',
          'บันทึกข้อมูลลูกค้าไม่สำเร็จ ตรวจสอบข้อมูลแล้วลองอีกครั้ง การแก้ไขของคุณยังอยู่',
        ),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void save();
  }

  return (
    <dialog
      ref={dialogRef}
      className={`${post.dialog} ${confirming ? post.confirmingDialog : ''}`}
      role={confirming ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-busy={busy || undefined}
      aria-labelledby={confirming ? confirmationTitleId : titleId}
      aria-describedby={confirming ? confirmationDescriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (closingRef.current) return;
        if (confirming) cancelConfirmation();
        else requestClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || !confirming || busy) return;
        const first = safeActionRef.current;
        const last = confirmActionRef.current;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
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
          requestClose();
      }}
    >
      <form
        onSubmit={submit}
        className={s.editorForm}
        aria-busy={busy}
        hidden={confirming}
        onFocusCapture={(event) => {
          lastEditingFocus.current = event.target as HTMLElement;
        }}
      >
        <header className={post.header}>
          <div>
            <span className={post.eyebrow}>{t('CUSTOMER DETAILS', 'ข้อมูลลูกค้า')}</span>
            <h2 id={titleId}>
              {customer
                ? t('Edit customer', 'แก้ไขข้อมูลลูกค้า')
                : t('Add customer', 'เพิ่มลูกค้า')}
            </h2>
            <p>
              {t(
                'Keep contact and business details together.',
                'เก็บข้อมูลติดต่อและรายละเอียดธุรกิจไว้ด้วยกัน',
              )}
            </p>
          </div>
          <button
            type="button"
            className={post.iconButton}
            disabled={busy}
            aria-label={t('Close customer editor', 'ปิดการแก้ไขลูกค้า')}
            onClick={requestClose}
          >
            <X size={21} />
          </button>
        </header>
        <div className={s.editorBody}>
          <fieldset className={s.editorFields} disabled={busy}>
            <legend className={s.srOnly}>{t('Customer details', 'ข้อมูลลูกค้า')}</legend>
            <section className={s.formSection}>
              <div className={s.formSectionHeading}>
                <Building2 size={20} />
                <h3>{t('Company and customer', 'บริษัทและลูกค้า')}</h3>
              </div>
              <p className={s.requiredHint}>
                {t(
                  'Customer name and your company are required. Other details are optional.',
                  'กรุณากรอกชื่อลูกค้าและเลือกบริษัทของคุณ ข้อมูลอื่นเว้นว่างได้',
                )}
              </p>
              <div className={s.formGrid}>
                <label className={s.fullWidth}>
                  {t('Customer name', 'ชื่อลูกค้า')}
                  <input
                    ref={nameRef}
                    required
                    maxLength={200}
                    placeholder={t('Name or business', 'ชื่อบุคคลหรือธุรกิจ')}
                    value={draft.name}
                    onChange={(event) => setField('name', event.target.value)}
                  />
                </label>
                <SelectionField
                  label={t('Your company', 'บริษัทของคุณ')}
                  value={draft.companyId}
                  onSelect={(value) => setField('companyId', value)}
                  t={t}
                  disabled={busy}
                  options={sortCatalog(data.companies).map((item) => {
                    const businessType = data.businessTypes.find(
                      (entry) => entry.id === item.businessTypeId,
                    );
                    return {
                      value: item.id,
                      en: item.name,
                      th: item.name,
                      descriptionEn: businessType?.name,
                      descriptionTh: businessType?.nameTh || businessType?.name,
                    };
                  })}
                />
                <label>
                  {t('Customer organization', 'บริษัทหรือองค์กรของลูกค้า')}
                  <input
                    maxLength={200}
                    placeholder={t('Company or organization', 'ชื่อบริษัทหรือองค์กร')}
                    value={draft.organization}
                    onChange={(event) => setField('organization', event.target.value)}
                  />
                </label>
                <div className={s.fullWidth}>
                  <CustomerProductField
                    products={data.products}
                    availableIds={availableProductIds}
                    value={draft.productIds ?? []}
                    onChange={(ids) => {
                      setQuantities((current) =>
                        Object.fromEntries(
                          Object.entries(current).filter(([id]) => ids.includes(id)),
                        ),
                      );
                      setDraft((current) => {
                        const next = { ...current, productIds: ids };
                        if (current.productQuantities) {
                          const retained = Object.fromEntries(
                            Object.entries(current.productQuantities).filter(([id]) =>
                              ids.includes(id),
                            ),
                          );
                          if (Object.keys(retained).length) next.productQuantities = retained;
                          else delete next.productQuantities;
                        }
                        return next;
                      });
                    }}
                    quantities={customer ? undefined : quantities}
                    onQuantityChange={
                      customer
                        ? undefined
                        : (id, value) => setQuantities((current) => ({ ...current, [id]: value }))
                    }
                    t={t}
                    disabled={busy}
                  />
                  {customer && (
                    <button
                      type="button"
                      className={`${s.smallButton} ${s.editorOrdersButton}`}
                      aria-haspopup="dialog"
                      onClick={() => onOpenOrders(customer.id)}
                      disabled={busy}
                    >
                      <History size={18} aria-hidden="true" />
                      {t('Order history', 'ประวัติออเดอร์')}
                    </button>
                  )}
                </div>
              </div>
              {type && (
                <p className={s.profileNote}>
                  <Settings2 size={16} />
                  <span>
                    {t('Business type', 'ประเภทธุรกิจ')}:{' '}
                    <strong>{t(type.name, type.nameTh || type.name)}</strong>
                    <small>
                      {t(
                        'The company’s business type controls the extra sections below. Saved details stay available when the type changes.',
                        'ประเภทธุรกิจของบริษัทกำหนดหมวดเพิ่มเติมด้านล่าง ข้อมูลเดิมจะยังถูกเก็บไว้เมื่อเปลี่ยนประเภท',
                      )}
                    </small>
                  </span>
                </p>
              )}
            </section>
            <section className={s.formSection}>
              <div className={s.formSectionHeading}>
                <UserRound size={20} />
                <h3>{t('Contact details', 'ข้อมูลติดต่อ')}</h3>
              </div>
              <div className={s.formGrid}>
                <label>
                  {t('Contact person', 'ชื่อผู้ติดต่อ')}
                  <input
                    maxLength={200}
                    placeholder={t('Full name', 'ชื่อ-นามสกุล')}
                    value={draft.contactName}
                    onChange={(event) => setField('contactName', event.target.value)}
                  />
                </label>
                <label>
                  {t('Email', 'อีเมล')}
                  <input
                    type="email"
                    maxLength={254}
                    placeholder="name@example.com"
                    value={draft.email}
                    onChange={(event) => setField('email', event.target.value)}
                  />
                </label>
                <label>
                  {t('Phone / contact number', 'โทรศัพท์ / เบอร์ติดต่อ')}
                  <input
                    type="tel"
                    maxLength={100}
                    placeholder={t('Phone number', 'เบอร์โทรศัพท์')}
                    value={draft.phone}
                    onChange={(event) => setField('phone', event.target.value)}
                  />
                </label>
                <label>
                  {t('Website', 'เว็บไซต์')}
                  <input
                    type="text"
                    inputMode="url"
                    maxLength={2048}
                    placeholder="https://example.com"
                    value={draft.website}
                    onChange={(event) => setField('website', event.target.value)}
                  />
                </label>
                <div className={s.firstContactField}>
                  <CalendarField
                    label={t('First contact', 'ติดต่อครั้งแรก')}
                    value={draft.firstContactOn ?? ''}
                    onChange={(value) => setField('firstContactOn', value)}
                    max={bangkokToday}
                    t={t}
                    disabled={busy}
                  />
                  <div className={s.elapsedContact} aria-live="polite">
                    <span>{t('Time since first contact', 'ระยะเวลาตั้งแต่ติดต่อครั้งแรก')}</span>
                    <output>
                      {elapsed ? `${elapsed.years}Y${elapsed.months}M${elapsed.days}D` : '-'}
                    </output>
                  </div>
                </div>
                <CalendarField
                  label={t('Last chat / contact date', 'วันที่แชต / ติดต่อล่าสุด')}
                  value={draft.lastContactOn}
                  onChange={(value) => setField('lastContactOn', value)}
                  t={t}
                  disabled={busy}
                />
              </div>
            </section>
            <section className={s.formSection}>
              <div className={s.formSectionHeading}>
                <MapPin size={20} />
                <h3>{t('Recipient', 'ผู้รับ')}</h3>
              </div>
              <OrderAddressFields
                value={recipientForCustomer(draft)}
                onChange={(value) => setField('recipient', value)}
                prefix={t('Recipient', 'ผู้รับ')}
                t={t}
                disabled={busy}
              />
            </section>
            {(socialEnabled || hasSocialDetails) && (
              <section className={s.formSection}>
                <div className={s.repeatHeading}>
                  <div className={s.formSectionHeading}>
                    <MessageCircle size={20} />
                    <h3>{t('Social and chat links', 'ลิงก์โซเชียลและแชต')}</h3>
                  </div>
                  <button
                    type="button"
                    className={s.smallButton}
                    disabled={draft.socialLinks.length >= maxSocialLinks}
                    onClick={() =>
                      setField('socialLinks', [
                        ...draft.socialLinks,
                        { id: crypto.randomUUID(), type: 'facebook', label: '', url: '' },
                      ])
                    }
                  >
                    <Plus size={17} />
                    {t('Add link', 'เพิ่มลิงก์')}
                  </button>
                </div>
                {!socialEnabled && (
                  <p className={s.retainedNote}>
                    {t(
                      'Saved social details from another business type. You can edit or remove them here.',
                      'ข้อมูลโซเชียลที่บันทึกจากประเภทธุรกิจอื่น คุณสามารถแก้ไขหรือนำออกได้ที่นี่',
                    )}
                  </p>
                )}
                {!draft.socialLinks.length && (
                  <p className={s.sectionEmpty}>
                    {t(
                      'Add the customer’s social profiles or chat links.',
                      'เพิ่มโปรไฟล์โซเชียลหรือลิงก์แชตของลูกค้า',
                    )}
                  </p>
                )}
                {draft.socialLinks.map((link, index) => {
                  const contactType = customerContactType(link);
                  return (
                    <div className={`${s.repeatRow} ${s.socialRow}`} key={link.id}>
                      <div className={s.contactTypeField}>
                        <SelectionField
                          label={t('Label', 'ชื่อกำกับ')}
                          value={contactType}
                          options={CONTACT_TYPES.map((option) => ({
                            ...option,
                            icon: <CustomerContactIcon type={option.value} />,
                          }))}
                          t={t}
                          disabled={busy}
                          onSelect={(value) =>
                            setField(
                              'socialLinks',
                              draft.socialLinks.map((item) =>
                                item.id === link.id
                                  ? {
                                      ...item,
                                      type: value,
                                      label:
                                        value === 'custom'
                                          ? item.label
                                          : CONTACT_TYPES.find((option) => option.value === value)!
                                              .en,
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                        {contactType === 'custom' && (
                          <label>
                            {t('Custom label', 'ชื่อกำกับเอง')}
                            <input
                              maxLength={100}
                              placeholder={t('e.g. Support chat', 'เช่น แชตบริการลูกค้า')}
                              value={link.label}
                              onChange={(event) =>
                                setField(
                                  'socialLinks',
                                  draft.socialLinks.map((item) =>
                                    item.id === link.id
                                      ? { ...item, label: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </label>
                        )}
                      </div>
                      <label>
                        {contactType === 'email'
                          ? t('Email address', 'อีเมล')
                          : contactType === 'phone'
                            ? t('Phone number', 'เบอร์โทรศัพท์')
                            : t('HTTPS link', 'ลิงก์ HTTPS')}
                        <input
                          type="text"
                          inputMode={
                            contactType === 'email'
                              ? 'email'
                              : contactType === 'phone'
                                ? 'tel'
                                : 'url'
                          }
                          maxLength={2048}
                          placeholder={
                            contactType === 'email'
                              ? 'name@example.com'
                              : contactType === 'phone'
                                ? '+66 81 234 5678'
                                : contactType === 'facebook'
                                  ? 'https://facebook.com/…'
                                  : contactType === 'line'
                                    ? 'https://line.me/…'
                                    : contactType === 'whatsapp'
                                      ? 'https://wa.me/…'
                                      : contactType === 'instagram'
                                        ? 'https://instagram.com/…'
                                        : 'https://example.com'
                          }
                          value={link.url}
                          onChange={(event) =>
                            setField(
                              'socialLinks',
                              draft.socialLinks.map((item) =>
                                item.id === link.id ? { ...item, url: event.target.value } : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        className={s.iconButton}
                        type="button"
                        aria-label={t(
                          `Remove social link ${index + 1}`,
                          `ลบลิงก์โซเชียลที่ ${index + 1}`,
                        )}
                        onClick={() =>
                          setField(
                            'socialLinks',
                            draft.socialLinks.filter((item) => item.id !== link.id),
                          )
                        }
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  );
                })}
              </section>
            )}
            {(type?.customerSections.includes('domains') || draft.domains.length > 0) && (
              <section className={s.formSection}>
                <div className={s.repeatHeading}>
                  <div className={s.formSectionHeading}>
                    <Globe2 size={20} />
                    <h3>{t('Domains', 'โดเมน')}</h3>
                  </div>
                  <button
                    type="button"
                    className={s.smallButton}
                    disabled={draft.domains.length >= 100}
                    onClick={() =>
                      setField('domains', [
                        ...draft.domains,
                        { id: crypto.randomUUID(), domain: '', expiresOn: '' },
                      ])
                    }
                  >
                    <Plus size={17} />
                    {t('Add domain', 'เพิ่มโดเมน')}
                  </button>
                </div>
                {!type?.customerSections.includes('domains') && (
                  <p className={s.retainedNote}>
                    {t(
                      'Saved domain details from another business type. You can edit or remove them here.',
                      'ข้อมูลโดเมนที่บันทึกจากประเภทธุรกิจอื่น คุณสามารถแก้ไขหรือนำออกได้ที่นี่',
                    )}
                  </p>
                )}
                {!draft.domains.length && (
                  <p className={s.sectionEmpty}>
                    {t(
                      'Keep each domain and its actual expiry date together.',
                      'เก็บโดเมนแต่ละชื่อพร้อมวันหมดอายุจริง',
                    )}
                  </p>
                )}
                {draft.domains.map((domain, index) => (
                  <div className={s.repeatRow} key={domain.id}>
                    <label>
                      {t('Domain name', 'ชื่อโดเมน')}
                      <input
                        type="text"
                        inputMode="url"
                        maxLength={253}
                        placeholder="example.com"
                        value={domain.domain}
                        onChange={(event) =>
                          setField(
                            'domains',
                            draft.domains.map((item) =>
                              item.id === domain.id
                                ? { ...item, domain: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <CalendarField
                      label={t('Expiry date', 'วันหมดอายุ')}
                      value={domain.expiresOn}
                      t={t}
                      disabled={busy}
                      onChange={(value) =>
                        setField(
                          'domains',
                          draft.domains.map((item) =>
                            item.id === domain.id ? { ...item, expiresOn: value } : item,
                          ),
                        )
                      }
                    />
                    <button
                      className={s.iconButton}
                      type="button"
                      aria-label={t(`Remove domain ${index + 1}`, `ลบโดเมนที่ ${index + 1}`)}
                      onClick={() =>
                        setField(
                          'domains',
                          draft.domains.filter((item) => item.id !== domain.id),
                        )
                      }
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </section>
            )}
            {(type?.customerSections.includes('github') || draft.githubAccounts.length > 0) && (
              <section className={s.formSection}>
                <div className={s.repeatHeading}>
                  <div className={s.formSectionHeading}>
                    <Github size={20} />
                    <h3>{t('GitHub accounts', 'บัญชี GitHub')}</h3>
                  </div>
                  <button
                    type="button"
                    className={s.smallButton}
                    disabled={draft.githubAccounts.length >= 100}
                    onClick={() =>
                      setField('githubAccounts', [
                        ...draft.githubAccounts,
                        { id: crypto.randomUUID(), name: '', email: '', username: '' },
                      ])
                    }
                  >
                    <Plus size={17} />
                    {t('Add account', 'เพิ่มบัญชี')}
                  </button>
                </div>
                {!type?.customerSections.includes('github') && (
                  <p className={s.retainedNote}>
                    {t(
                      'Saved GitHub details from another business type. You can edit or remove them here.',
                      'ข้อมูล GitHub ที่บันทึกจากประเภทธุรกิจอื่น คุณสามารถแก้ไขหรือนำออกได้ที่นี่',
                    )}
                  </p>
                )}
                {!draft.githubAccounts.length && (
                  <p className={s.sectionEmpty}>
                    {t(
                      'Record account names and contact details.',
                      'บันทึกชื่อบัญชีและข้อมูลติดต่อ',
                    )}
                  </p>
                )}
                {draft.githubAccounts.map((account, index) => (
                  <div className={s.githubRow} key={account.id}>
                    <label>
                      {t('GitHub name', 'ชื่อบัญชี GitHub')}
                      <input
                        maxLength={200}
                        placeholder={t('Account name', 'ชื่อบัญชี')}
                        value={account.name}
                        onChange={(event) =>
                          setField(
                            'githubAccounts',
                            draft.githubAccounts.map((item) =>
                              item.id === account.id ? { ...item, name: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      {t('Username', 'ชื่อผู้ใช้')}
                      <input
                        maxLength={100}
                        placeholder={t('Username', 'ชื่อผู้ใช้')}
                        value={account.username}
                        onChange={(event) =>
                          setField(
                            'githubAccounts',
                            draft.githubAccounts.map((item) =>
                              item.id === account.id
                                ? { ...item, username: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      {t('GitHub email', 'อีเมล GitHub')}
                      <input
                        type="email"
                        maxLength={254}
                        placeholder="name@example.com"
                        value={account.email}
                        onChange={(event) =>
                          setField(
                            'githubAccounts',
                            draft.githubAccounts.map((item) =>
                              item.id === account.id
                                ? { ...item, email: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      className={s.iconButton}
                      type="button"
                      aria-label={t(
                        `Remove GitHub account ${index + 1}`,
                        `ลบบัญชี GitHub ที่ ${index + 1}`,
                      )}
                      onClick={() =>
                        setField(
                          'githubAccounts',
                          draft.githubAccounts.filter((item) => item.id !== account.id),
                        )
                      }
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </section>
            )}
            {!!type?.customerFields.some((field) => !field.archived) && (
              <section className={s.formSection}>
                <div className={s.formSectionHeading}>
                  <Settings2 size={20} />
                  <h3>{t('Additional details', 'ข้อมูลเพิ่มเติม')}</h3>
                </div>
                <div className={s.formGrid}>
                  {type.customerFields
                    .filter((field) => !field.archived)
                    .map((field) =>
                      field.type === 'date' ? (
                        <CalendarField
                          key={field.id}
                          label={field.label}
                          value={draft.fieldValues[field.id] ?? ''}
                          onChange={(value) =>
                            setField('fieldValues', { ...draft.fieldValues, [field.id]: value })
                          }
                          t={t}
                          disabled={busy}
                        />
                      ) : (
                        <label
                          key={field.id}
                          className={field.type === 'textarea' ? s.fullWidth : undefined}
                        >
                          {field.label}
                          {field.type === 'textarea' ? (
                            <textarea
                              rows={4}
                              maxLength={10000}
                              placeholder={t('Add details', 'กรอกรายละเอียด')}
                              value={draft.fieldValues[field.id] ?? ''}
                              onChange={(event) =>
                                setField('fieldValues', {
                                  ...draft.fieldValues,
                                  [field.id]: event.target.value,
                                })
                              }
                            />
                          ) : (
                            <input
                              type={field.type === 'email' ? 'email' : 'text'}
                              inputMode={field.type === 'url' ? 'url' : undefined}
                              maxLength={2048}
                              placeholder={
                                field.type === 'url'
                                  ? 'https://example.com'
                                  : field.type === 'email'
                                    ? 'name@example.com'
                                    : t('Enter details', 'กรอกข้อมูล')
                              }
                              value={draft.fieldValues[field.id] ?? ''}
                              onChange={(event) =>
                                setField('fieldValues', {
                                  ...draft.fieldValues,
                                  [field.id]: event.target.value,
                                })
                              }
                            />
                          )}
                        </label>
                      ),
                    )}
                </div>
              </section>
            )}
            {retainedFields.length > 0 && (
              <section className={s.formSection}>
                <div className={s.formSectionHeading}>
                  <Settings2 size={20} />
                  <h3>{t('Retained details', 'ข้อมูลเดิมที่เก็บไว้')}</h3>
                </div>
                <p className={s.retainedNote}>
                  {t(
                    'Saved fields from another business type or an archived field stay available here.',
                    'ข้อมูลที่บันทึกจากประเภทธุรกิจอื่นหรือช่องที่เก็บถาวรยังสามารถแก้ไขได้ที่นี่',
                  )}
                </p>
                {retainedFields.map(({ field, value, businessType }, index) => (
                  <div className={s.retainedField} key={field.id}>
                    <div>
                      {field.type === 'date' ? (
                        <CalendarField
                          label={businessType ? field.label : `${field.label} ${index + 1}`}
                          value={value}
                          onChange={(nextValue) =>
                            setField('fieldValues', { ...draft.fieldValues, [field.id]: nextValue })
                          }
                          t={t}
                          disabled={busy}
                        />
                      ) : (
                        <label>
                          {businessType ? field.label : `${field.label} ${index + 1}`}
                          {field.type === 'textarea' ? (
                            <textarea
                              rows={3}
                              maxLength={10000}
                              placeholder={t('Add details', 'กรอกรายละเอียด')}
                              value={value}
                              onChange={(event) =>
                                setField('fieldValues', {
                                  ...draft.fieldValues,
                                  [field.id]: event.target.value,
                                })
                              }
                            />
                          ) : (
                            <input
                              type={field.type === 'email' ? 'email' : 'text'}
                              inputMode={field.type === 'url' ? 'url' : undefined}
                              maxLength={2048}
                              placeholder={
                                field.type === 'url'
                                  ? 'https://example.com'
                                  : field.type === 'email'
                                    ? 'name@example.com'
                                    : t('Enter details', 'กรอกข้อมูล')
                              }
                              value={value}
                              onChange={(event) =>
                                setField('fieldValues', {
                                  ...draft.fieldValues,
                                  [field.id]: event.target.value,
                                })
                              }
                            />
                          )}
                        </label>
                      )}
                      {businessType && (
                        <small>
                          {t(businessType.name, businessType.nameTh || businessType.name)}
                          {field.archived ? ` · ${t('Archived field', 'ช่องที่เก็บถาวร')}` : ''}
                        </small>
                      )}
                    </div>
                    <button
                      className={s.iconButton}
                      type="button"
                      aria-label={t(
                        `Clear retained ${field.label}`,
                        `ล้างข้อมูลเดิม ${field.label}`,
                      )}
                      onClick={() =>
                        setField('fieldValues', { ...draft.fieldValues, [field.id]: '' })
                      }
                    >
                      <X size={18} />
                    </button>
                  </div>
                ))}
              </section>
            )}
            <section className={s.formSection}>
              <div className={s.formSectionHeading}>
                <Pencil size={19} />
                <h3>{t('Notes', 'บันทึก')}</h3>
              </div>
              <label className={s.notesLabel}>
                <span className={s.srOnly}>{t('Customer notes', 'บันทึกข้อมูลลูกค้า')}</span>
                <textarea
                  rows={4}
                  maxLength={10000}
                  value={draft.notes}
                  onChange={(event) => setField('notes', event.target.value)}
                  placeholder={t('Add a note', 'เพิ่มบันทึก')}
                />
              </label>
            </section>
          </fieldset>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className={s.editorFooter}>
          {baseline && (
            <button
              type="button"
              className={post.deleteButton}
              disabled={busy}
              onClick={() => {
                setError('');
                setDeleteOpen(true);
              }}
            >
              <Trash2 size={17} />
              {t('Move to Trash', 'ย้ายไปถังขยะ')}
            </button>
          )}
          <div>
            <button
              type="button"
              className={post.cancelButton}
              disabled={busy}
              onClick={requestClose}
            >
              {t('Cancel', 'ยกเลิก')}
            </button>
            <button type="submit" className={post.saveButton} disabled={busy}>
              <Check size={18} />
              {busy
                ? t('Saving…', 'กำลังบันทึก…')
                : hasOrder
                  ? t('Save customer and order', 'บันทึกลูกค้าและออเดอร์')
                  : t('Save customer', 'บันทึกลูกค้า')}
            </button>
          </div>
        </footer>
      </form>
      {confirming && (
        <section className={post.discardPanel}>
          <span className={`${post.discardIcon} ${deleteOpen ? post.deleteIcon : ''}`}>
            {deleteOpen ? (
              <Trash2 size={25} aria-hidden="true" />
            ) : (
              <AlertTriangle size={25} aria-hidden="true" />
            )}
          </span>
          <span className={`${post.eyebrow} ${deleteOpen ? post.dangerEyebrow : ''}`}>
            {deleteOpen
              ? t('MOVE TO TRASH', 'ย้ายไปถังขยะ')
              : t('UNSAVED CHANGES', 'การแก้ไขที่ยังไม่บันทึก')}
          </span>
          <h2 id={confirmationTitleId}>
            {deleteOpen
              ? t('Move customer to Trash?', 'ย้ายลูกค้าไปถังขยะ?')
              : t('Discard unsaved changes?', 'ทิ้งการแก้ไขที่ยังไม่บันทึก?')}
          </h2>
          <p id={confirmationDescriptionId}>
            {deleteOpen
              ? t(
                  `“${baseline?.name}” will move to Trash. You can restore it within 30 days.`,
                  `“${baseline?.name}” จะถูกย้ายไปถังขยะ คุณสามารถกู้คืนได้ภายใน 30 วัน`,
                )
              : t(
                  'Your saved customer details will stay as they are.',
                  'ข้อมูลลูกค้าที่บันทึกไว้จะยังคงเดิม',
                )}
          </p>
          {deleteOpen && error && (
            <p className={post.deleteError} role="alert">
              {error}
            </p>
          )}
          <div className={post.discardActions}>
            <button
              ref={safeActionRef}
              type="button"
              className={post.cancelButton}
              disabled={busy}
              onClick={cancelConfirmation}
            >
              {deleteOpen ? t('Cancel', 'ยกเลิก') : t('Keep editing', 'แก้ไขต่อ')}
            </button>
            <button
              ref={confirmActionRef}
              type="button"
              className={deleteOpen ? post.confirmDeleteButton : post.discardButton}
              disabled={busy}
              onClick={() => {
                if (deleteOpen) void save(true);
                else finishClose();
              }}
            >
              {deleteOpen
                ? busy
                  ? t('Moving…', 'กำลังย้าย…')
                  : t('Move to Trash', 'ย้ายไปถังขยะ')
                : t('Discard changes', 'ทิ้งการแก้ไข')}
            </button>
          </div>
        </section>
      )}
    </dialog>
  );
}
