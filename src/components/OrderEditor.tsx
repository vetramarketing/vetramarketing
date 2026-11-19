'use client';

import { useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { MapPin, Package, Plus, Save, ShoppingBag, Trash2, UserRound, X } from 'lucide-react';
import { recipientForCustomer } from '@/lib/order-customer';
import { bangkokCalendarNow } from '@/lib/calendar';
import { effectiveProductCompanyIds } from '@/lib/product-company';
import {
  emptyShippingAddress,
  defaultShippingSettings,
  formatMoneySatang,
  MAX_ORDER_QUANTITY,
  orderTotals,
  parseMoneySatang,
  prepareOrderSave,
  prepareOrderTrash,
  type Order,
  type OrderItem,
  type ShippingAddress,
} from '@/lib/orders';
import CalendarField from './CalendarField';
import SelectionField from './SelectionField';
import OrderAddressFields from './OrderAddressFields';
import { carrierOptions, orderErrorMessage, paymentOptions, statusOptions } from './order-ui';
import type { OrdersProps } from './OrdersPanel';
import s from './OrdersPanel.module.css';
import p from './PostEditor.module.css';
import dialogStyles from './OrderEditor.module.css';

function newOrder(data: OrdersProps['data'], companyId: string): Order {
  const company = companyId === 'all' ? (data.companies[0]?.id ?? '') : companyId;
  const settings = data.shippingSettings ?? defaultShippingSettings();
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    number: '',
    companyId: company,
    customerName: '',
    orderedOn: bangkokCalendarNow(),
    items: [],
    discountSatang: 0,
    shippingSatang: 0,
    paymentMethod: 'transfer',
    status: 'ordered',
    recipient: emptyShippingAddress(),
    carrier: settings.defaultCarrier,
    parcel: { weightGrams: 0, widthCm: 0, lengthCm: 0, heightCm: 0 },
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
}

const moneyInput = (satang: number) => (satang / 100).toFixed(2);

export default function OrderEditor({
  data,
  companyId,
  update,
  t,
  notify,
  order,
  onClose,
}: OrdersProps & {
  order?: Order;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Order>(() =>
    structuredClone(order ?? newOrder(data, companyId)),
  );
  const original = order;
  const [initial] = useState(draft);
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(draft.items.map((item) => [item.id, moneyInput(item.unitPriceSatang)])),
  );
  const [discount, setDiscount] = useState(moneyInput(draft.discountSatang));
  const [shipping, setShipping] = useState(moneyInput(draft.shippingSatang));
  const [product, setProduct] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'discard' | 'trash' | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const safeAction = useRef<HTMLButtonElement>(null);
  const previousAction = useRef<HTMLElement | null>(null);
  const selectedRecipient = useRef<ShippingAddress | null>(null);
  const latest = useRef(data);
  latest.current = data;
  const inFlight = useRef(false);
  const titleId = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    if (confirm) safeAction.current?.focus();
    else if (previousAction.current?.isConnected)
      previousAction.current.focus({ preventScroll: true });
  }, [confirm]);
  function ask(action: 'discard' | 'trash') {
    previousAction.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirm(action);
  }
  const productOptions = data.products.filter(
    (item) =>
      !item.deletedAt && effectiveProductCompanyIds(item, data.posts).includes(draft.companyId),
  );
  const customers = data.customers.filter(
    (customer) => !customer.deletedAt && customer.companyId === draft.companyId,
  );
  const locked = Boolean(draft.shipment || draft.label);
  const numericDraft = useMemo(
    () => ({
      ...draft,
      items: draft.items.map((item) => ({
        ...item,
        unitPriceSatang: parseMoneySatang(prices[item.id] ?? '') ?? -1,
      })),
      discountSatang: parseMoneySatang(discount) ?? -1,
      shippingSatang: parseMoneySatang(shipping) ?? -1,
    }),
    [draft, prices, discount, shipping],
  );
  const dirty = JSON.stringify(numericDraft) !== JSON.stringify(initial);
  const totals = useMemo(() => {
    try {
      return orderTotals(numericDraft);
    } catch {
      return null;
    }
  }, [numericDraft]);
  function close() {
    if (busy) return;
    if (confirm) setConfirm(null);
    else if (dirty) ask('discard');
    else onClose();
  }
  function showError(cause: unknown) {
    setError(orderErrorMessage(cause, t));
  }
  function materialize(): Order {
    if (draft.quantitySource) return draft;
    if (
      numericDraft.discountSatang < 0 ||
      numericDraft.shippingSatang < 0 ||
      numericDraft.items.some((item) => item.unitPriceSatang < 0)
    )
      throw new Error(
        t(
          'Enter valid prices, discount, and shipping with no more than two decimal places.',
          'กรอกราคา ส่วนลด และค่าจัดส่งให้ถูกต้อง โดยใช้ทศนิยมไม่เกิน 2 ตำแหน่ง',
        ),
      );
    if (
      numericDraft.items.some(
        (item) => !Number.isInteger(item.quantity) || item.quantity <= 0 || !item.name.trim(),
      )
    )
      throw new Error(
        t(
          'Each item needs a name and a whole-number quantity greater than zero.',
          'สินค้าทุกรายการต้องมีชื่อและจำนวนเต็มที่มากกว่า 0',
        ),
      );
    return numericDraft;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const selected = selectedRecipient.current;
      if (selected && draft.customerId) {
        const customer = latest.current.customers.find(
          (item) =>
            item.id === draft.customerId && item.companyId === draft.companyId && !item.deletedAt,
        );
        if (!customer)
          throw new Error(
            t(
              'Choose an active customer belonging to this company.',
              'เลือกลูกค้าที่ยังใช้งานอยู่และเป็นลูกค้าของบริษัทนี้',
            ),
          );
        const current = recipientForCustomer(customer);
        const fields = Object.keys(current) as (keyof ShippingAddress)[];
        if (fields.some((key) => selected[key] !== current[key])) {
          const recipient = { ...draft.recipient };
          for (const key of fields) {
            if (recipient[key] === selected[key]) recipient[key] = current[key];
          }
          selectedRecipient.current = current;
          setDraft({ ...draft, recipient });
          throw new Error(
            t(
              'This customer’s delivery details changed. Review the recipient and save again.',
              'ข้อมูลจัดส่งของลูกค้าเปลี่ยนแปลง โปรดตรวจสอบผู้รับแล้วบันทึกอีกครั้ง',
            ),
          );
        }
      }
      const next = prepareOrderSave(
        latest.current,
        { ...materialize(), updatedAt: new Date().toISOString() },
        original ?? null,
      );
      if (!(await update(next)))
        throw new Error(
          t('The order was not saved. Try again.', 'ยังไม่ได้บันทึกออเดอร์ โปรดลองอีกครั้ง'),
        );
      notify(t('Order saved.', 'บันทึกออเดอร์แล้ว'));
      onClose();
    } catch (cause) {
      showError(cause);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function trash() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      if (!original) return;
      if (!(await update(prepareOrderTrash(latest.current, original))))
        throw new Error(
          t(
            'The order was not moved to Trash. Reopen it and try again.',
            'ยังไม่ได้ย้ายออเดอร์ไปถังขยะ โปรดเปิดใหม่แล้วลองอีกครั้ง',
          ),
        );
      notify(t('Order moved to Trash for 30 days.', 'ย้ายออเดอร์ไปถังขยะ เก็บไว้ 30 วัน'));
      onClose();
    } catch (cause) {
      showError(cause);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function addItem() {
    const catalog = productOptions.find((item) => item.id === product);
    if (product && !catalog) return;
    const id = crypto.randomUUID();
    setDraft((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          id,
          ...(catalog ? { productId: catalog.id } : {}),
          name: catalog?.name ?? '',
          quantity: 1,
          unitPriceSatang: 0,
        },
      ],
    }));
    setPrices((current) => ({ ...current, [id]: '' }));
    setProduct('');
  }
  function changeItem(id: string, fields: Partial<OrderItem>) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? { ...item, ...fields } : item)),
    }));
  }
  return (
    <dialog
      ref={dialog}
      className={`${p.dialog} ${confirm ? p.confirmingDialog : dialogStyles.editor}`}
      role={confirm ? 'alertdialog' : 'dialog'}
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          close();
      }}
    >
      {confirm && (
        <div className={p.discardPanel}>
          <h2 id={titleId}>
            {confirm === 'discard'
              ? t('Discard unsaved changes?', 'ยกเลิกการเปลี่ยนแปลงที่ยังไม่บันทึก?')
              : t('Move this order to Trash?', 'ย้ายออเดอร์ไปถังขยะ?')}
          </h2>
          {confirm === 'trash' && (
            <p>{t('You can restore it within 30 days.', 'คุณสามารถกู้คืนได้ภายใน 30 วัน')}</p>
          )}
          {error && (
            <p className={p.error} role="alert">
              {error}
            </p>
          )}
          <div className={p.discardActions}>
            <button
              ref={safeAction}
              type="button"
              disabled={busy}
              className={p.cancelButton}
              onClick={() => setConfirm(null)}
            >
              {t('Go back', 'กลับ')}
            </button>
            <button
              type="button"
              disabled={busy}
              className={p.discardButton}
              onClick={confirm === 'trash' ? trash : onClose}
            >
              {confirm === 'trash'
                ? t('Move to Trash', 'ย้ายไปถังขยะ')
                : t('Discard changes', 'ยกเลิกการเปลี่ยนแปลง')}
            </button>
          </div>
        </div>
      )}
      <form onSubmit={submit} hidden={!!confirm} className={dialogStyles.form}>
        <header className={p.header}>
          <h2 id={confirm ? undefined : titleId}>
            {original?.number ?? t('New order', 'สร้างออเดอร์')}
          </h2>
          <button
            type="button"
            className={p.iconButton}
            disabled={busy}
            aria-label={t('Close order editor', 'ปิดการแก้ไขออเดอร์')}
            onClick={close}
          >
            <X size={21} />
          </button>
        </header>
        <div className={dialogStyles.body}>
          {draft.quantitySource && (
            <fieldset className={s.formFieldset} disabled={busy}>
              <section className={s.section}>
                <h3>{draft.customerName}</h3>
                <CalendarField
                  label={t('Order date', 'วันที่ออเดอร์')}
                  value={draft.orderedOn}
                  required={draft.quantitySource === 'quick'}
                  t={t}
                  onChange={(orderedOn) => setDraft({ ...draft, orderedOn })}
                />
                {original && !original.items.length && (
                  <label className={s.field}>
                    <span>{t('Quantity', 'จำนวน')}</span>
                    <input
                      type="number"
                      min={0}
                      max={MAX_ORDER_QUANTITY}
                      step="1"
                      inputMode="numeric"
                      placeholder={t('Quantity not recorded', 'ยังไม่ได้บันทึกจำนวน')}
                      value={draft.items[0]?.quantity ?? ''}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        setDraft({
                          ...draft,
                          items: Number.isFinite(value)
                            ? [
                                {
                                  id: draft.items[0]?.id ?? crypto.randomUUID(),
                                  name: 'Quantity',
                                  quantity: value,
                                  unitPriceSatang: 0,
                                },
                              ]
                            : [],
                        });
                      }}
                    />
                  </label>
                )}
                {!!original?.items.length &&
                  draft.items.map((item) => (
                    <label key={item.id} className={s.field}>
                      <span>
                        {item.productId ? item.name + ' · ' : ''}
                        {t('Quantity', 'จำนวน')}
                      </span>
                      <input
                        type="number"
                        required
                        inputMode="numeric"
                        step="1"
                        min={draft.quantitySource === 'imported' ? 0 : 1}
                        max={MAX_ORDER_QUANTITY}
                        value={Number.isFinite(item.quantity) ? item.quantity : ''}
                        onChange={(event) =>
                          changeItem(item.id, { quantity: event.target.valueAsNumber })
                        }
                      />
                    </label>
                  ))}
                <SelectionField
                  label={t('Order status', 'สถานะออเดอร์')}
                  t={t}
                  options={statusOptions}
                  value={draft.status}
                  onSelect={(status) =>
                    setDraft({
                      ...draft,
                      status,
                      paymentMethod: status === 'cod' ? 'cod' : draft.paymentMethod,
                    })
                  }
                />
              </section>
            </fieldset>
          )}
          {!draft.quantitySource && (
            <fieldset className={s.formFieldset} disabled={busy}>
              {locked && (
                <p className={s.note}>
                  {draft.shipment?.mode === 'training'
                    ? t(
                        'Test shipment. Its saved delivery details are locked.',
                        'พัสดุทดสอบ ข้อมูลจัดส่งที่บันทึกไว้ถูกล็อก',
                      )
                    : t(
                        'Delivery details are locked for this previously labeled or booked order.',
                        'ข้อมูลจัดส่งถูกล็อกเนื่องจากออเดอร์นี้มีใบปะหน้าหรือจองขนส่งไว้แล้ว',
                      )}
                </p>
              )}
              <section className={s.section}>
                <h3>
                  <UserRound size={21} />
                  {t('Customer & order', 'ลูกค้าและออเดอร์')}
                </h3>
                <div className={s.formGrid}>
                  <SelectionField
                    label={t('Company', 'บริษัท')}
                    value={draft.companyId}
                    disabled={
                      locked ||
                      Boolean(original) ||
                      Boolean(draft.items.length) ||
                      Boolean(draft.customerId)
                    }
                    onSelect={(value) => {
                      setProduct('');
                      setDraft({ ...draft, companyId: value });
                    }}
                    options={data.companies.map((item) => ({
                      value: item.id,
                      en: item.name,
                      th: item.name,
                    }))}
                    t={t}
                  />
                  <CalendarField
                    label={t('Order date', 'วันที่ออเดอร์')}
                    value={draft.orderedOn}
                    required
                    disabled={locked}
                    t={t}
                    onChange={(value) => setDraft({ ...draft, orderedOn: value })}
                  />
                  <SelectionField
                    label={t('Saved customer', 'ลูกค้าในระบบ')}
                    searchLabel={t('Search customers', 'ค้นหาลูกค้า')}
                    value={draft.customerId ?? ''}
                    disabled={locked}
                    onSelect={(value) => {
                      const customer = customers.find((item) => item.id === value);
                      const recipient = customer ? recipientForCustomer(customer) : null;
                      selectedRecipient.current = recipient;
                      setDraft({
                        ...draft,
                        customerId: customer?.id,
                        customerName: customer?.name ?? '',
                        recipient: recipient ?? emptyShippingAddress(),
                      });
                    }}
                    options={[
                      { value: '', en: 'Enter customer manually', th: 'กรอกลูกค้าด้วยตนเอง' },
                      ...customers.map((item) => {
                        const details = [
                          item.organization,
                          item.contactName,
                          item.phone || item.recipient?.phone,
                        ]
                          .filter(Boolean)
                          .join(' · ');
                        return {
                          value: item.id,
                          en: item.name,
                          th: item.name,
                          descriptionEn: details,
                          descriptionTh: details,
                        };
                      }),
                      ...(draft.customerId &&
                      !customers.some((item) => item.id === draft.customerId)
                        ? [
                            {
                              value: draft.customerId,
                              en: `${draft.customerName} (saved)`,
                              th: `${draft.customerName} (ข้อมูลเดิม)`,
                            },
                          ]
                        : []),
                    ]}
                    t={t}
                  />
                  {!draft.customerId && (
                    <label className={s.field}>
                      <span>{t('Customer name', 'ชื่อลูกค้า')}</span>
                      <input
                        value={draft.customerName}
                        disabled={locked}
                        maxLength={200}
                        onChange={(event) =>
                          setDraft({ ...draft, customerName: event.target.value })
                        }
                      />
                    </label>
                  )}
                  <SelectionField
                    label={t('Order status', 'สถานะออเดอร์')}
                    value={draft.status}
                    onSelect={(value) =>
                      setDraft({
                        ...draft,
                        status: value,
                        paymentMethod: value === 'cod' ? 'cod' : draft.paymentMethod,
                      })
                    }
                    options={statusOptions.filter(
                      (option) =>
                        (!locked || option.value !== 'cod' || draft.paymentMethod === 'cod') &&
                        (!draft.shipment || option.value !== 'cancelled') &&
                        (draft.shipment?.mode !== 'training' ||
                          !['shipped', 'completed'].includes(option.value)),
                    )}
                    t={t}
                  />
                  <SelectionField
                    label={t('Shipping company', 'บริษัทขนส่ง')}
                    value={draft.carrier}
                    disabled={locked}
                    onSelect={(value) => setDraft({ ...draft, carrier: value })}
                    options={carrierOptions}
                    t={t}
                  />
                </div>
              </section>
              <section className={s.section}>
                <h3>
                  <ShoppingBag size={21} />
                  {t('Order items', 'รายการสินค้า')}
                </h3>
                {!locked && (
                  <div className={s.addItem}>
                    <SelectionField
                      label={t('Product', 'สินค้า')}
                      value={product}
                      onSelect={setProduct}
                      options={[
                        { value: '', en: 'Custom item', th: 'รายการที่กำหนดเอง' },
                        ...productOptions.map((item) => ({
                          value: item.id,
                          en: item.name,
                          th: item.name,
                        })),
                      ]}
                      t={t}
                    />
                    <button
                      type="button"
                      className={s.secondaryButton}
                      onClick={addItem}
                      disabled={draft.items.length >= 100}
                    >
                      <Plus size={18} />
                      {t('Add item', 'เพิ่มรายการ')}
                    </button>
                  </div>
                )}
                {!draft.items.length && (
                  <p className={s.inlineEmpty}>
                    {t(
                      'Add a product or a custom item to start this order.',
                      'เพิ่มสินค้าหรือรายการที่กำหนดเองเพื่อเริ่มออเดอร์',
                    )}
                  </p>
                )}
                <div className={s.items}>
                  {draft.items.map((item, index) => (
                    <div className={s.item} key={item.id}>
                      <label className={s.field}>
                        <span>{t(`Item ${index + 1}`, `รายการ ${index + 1}`)}</span>
                        <input
                          value={item.name}
                          disabled={locked}
                          maxLength={200}
                          onChange={(event) => changeItem(item.id, { name: event.target.value })}
                          placeholder={t('Item name', 'ชื่อรายการ')}
                        />
                      </label>
                      <label className={s.field}>
                        <span>{t('Quantity', 'จำนวน')}</span>
                        <input
                          type="number"
                          min={1}
                          max={1000000}
                          step={1}
                          value={Number.isFinite(item.quantity) ? item.quantity : ''}
                          disabled={locked}
                          onChange={(event) =>
                            changeItem(item.id, {
                              quantity:
                                event.target.value === '' ? NaN : Number(event.target.value),
                            })
                          }
                          aria-label={t(
                            `Quantity for item ${index + 1}`,
                            `จำนวนรายการ ${index + 1}`,
                          )}
                        />
                      </label>
                      <label className={s.field}>
                        <span>{t('Unit price · THB', 'ราคาต่อชิ้น · บาท')}</span>
                        <input
                          inputMode="decimal"
                          value={prices[item.id] ?? ''}
                          disabled={locked}
                          onChange={(event) =>
                            setPrices({ ...prices, [item.id]: event.target.value })
                          }
                          aria-label={t(
                            `Unit price for item ${index + 1}`,
                            `ราคาต่อชิ้นรายการ ${index + 1}`,
                          )}
                          placeholder="0.00"
                        />
                      </label>
                      <span className={s.lineTotal}>
                        {parseMoneySatang(prices[item.id] ?? '') !== null &&
                        Number.isInteger(item.quantity) &&
                        item.quantity > 0
                          ? formatMoneySatang(
                              (parseMoneySatang(prices[item.id] ?? '') ?? 0) * item.quantity,
                            )
                          : '—'}
                      </span>
                      {!locked && (
                        <button
                          type="button"
                          className={s.iconButton}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              items: draft.items.filter((line) => line.id !== item.id),
                            })
                          }
                          aria-label={t(`Remove item ${index + 1}`, `ลบรายการ ${index + 1}`)}
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className={s.totalsLayout}>
                  <div className={s.formGrid}>
                    <label className={s.field}>
                      <span>{t('Discount · THB', 'ส่วนลด · บาท')}</span>
                      <input
                        inputMode="decimal"
                        disabled={locked}
                        value={discount}
                        onChange={(event) => setDiscount(event.target.value)}
                      />
                    </label>
                    <label className={s.field}>
                      <span>{t('Shipping charge · THB', 'ค่าจัดส่ง · บาท')}</span>
                      <input
                        inputMode="decimal"
                        disabled={locked}
                        value={shipping}
                        onChange={(event) => setShipping(event.target.value)}
                      />
                    </label>
                    <SelectionField
                      label={t('Payment method', 'วิธีชำระเงิน')}
                      value={draft.paymentMethod}
                      disabled={locked}
                      onSelect={(value) =>
                        setDraft({
                          ...draft,
                          paymentMethod: value,
                          status:
                            draft.status === 'ordered' && value === 'cod'
                              ? 'cod'
                              : draft.status === 'cod' && value !== 'cod'
                                ? 'ordered'
                                : draft.status,
                        })
                      }
                      options={paymentOptions}
                      t={t}
                    />
                  </div>
                  <div className={s.totals}>
                    <div>
                      <span>{t('Subtotal', 'รวมค่าสินค้า')}</span>
                      <span>{totals ? formatMoneySatang(totals.subtotalSatang) : '—'}</span>
                    </div>
                    <div>
                      <span>{t('Discount', 'ส่วนลด')}</span>
                      <span>{totals ? `−${formatMoneySatang(totals.discountSatang)}` : '—'}</span>
                    </div>
                    <div>
                      <span>{t('Shipping', 'ค่าจัดส่ง')}</span>
                      <span>{totals ? formatMoneySatang(totals.shippingSatang) : '—'}</span>
                    </div>
                    <div className={s.grandTotal}>
                      <strong>{t('Total · THB', 'ยอดรวม · บาท')}</strong>
                      <strong>{totals ? formatMoneySatang(totals.totalSatang) : '—'}</strong>
                    </div>
                  </div>
                </div>
              </section>
              <section className={s.section}>
                <h3>
                  <MapPin size={21} />
                  {t('Recipient', 'ผู้รับ')}
                </h3>
                {!locked && (draft.customerId || draft.customerName.trim()) && (
                  <p className={s.help}>
                    {t(
                      'Recipient changes also update the customer’s delivery details.',
                      'การแก้ไขผู้รับจะอัปเดตข้อมูลจัดส่งของลูกค้าด้วย',
                    )}
                  </p>
                )}
                <OrderAddressFields
                  prefix={t('Recipient', 'ผู้รับ')}
                  value={draft.recipient}
                  disabled={locked}
                  onChange={(value) => setDraft({ ...draft, recipient: value })}
                  t={t}
                />
              </section>
              <section className={s.section}>
                <h3>
                  <Package size={21} />
                  {t('Parcel', 'พัสดุ')}
                </h3>
                <div className={s.parcelFields}>
                  {(
                    [
                      ['weightGrams', 'Weight · g', 'น้ำหนัก · กรัม'],
                      ['widthCm', 'Width · cm', 'กว้าง · ซม.'],
                      ['lengthCm', 'Length · cm', 'ยาว · ซม.'],
                      ['heightCm', 'Height · cm', 'สูง · ซม.'],
                    ] as const
                  ).map(([key, en, th]) => (
                    <label className={s.field} key={key}>
                      <span>{t(en, th)}</span>
                      <input
                        type="number"
                        min={0}
                        max={key === 'weightGrams' ? 1000000 : 1000}
                        step={1}
                        disabled={locked}
                        value={draft.parcel[key] || ''}
                        placeholder="0"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            parcel: { ...draft.parcel, [key]: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </section>
              <section className={s.section}>
                <label className={s.field}>
                  <span>{t('Order notes', 'บันทึกออเดอร์')}</span>
                  <textarea
                    rows={3}
                    maxLength={4000}
                    value={draft.notes}
                    onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                  />
                </label>
              </section>
            </fieldset>
          )}
        </div>
        <footer className={p.footer}>
          {error && (
            <p className={p.error} role="alert">
              {error}
            </p>
          )}
          <div className={p.footerActions}>
            {original && !original.shipment && (
              <button
                type="button"
                disabled={busy}
                className={p.deleteButton}
                onClick={() => {
                  setError('');
                  ask('trash');
                }}
              >
                <Trash2 size={18} />
                {t('Move to Trash', 'ย้ายไปถังขยะ')}
              </button>
            )}
            <button type="button" disabled={busy} className={p.cancelButton} onClick={close}>
              {t('Cancel', 'ยกเลิก')}
            </button>
            <button type="submit" disabled={busy} className={p.saveButton}>
              <Save size={18} />
              {busy ? t('Saving…', 'กำลังบันทึก…') : t('Save order', 'บันทึกออเดอร์')}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
