'use client';

import { useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Box, Minus, Plus, Trash2, X } from 'lucide-react';
import { formatCalendarDate } from '@/lib/calendar';
import { MAX_ORDER_QUANTITY, prepareOrderTrash, type Order } from '@/lib/orders';
import { customerProductOrderHistory, prepareCustomerQuantityOrder } from '@/lib/customer-orders';
import { effectiveProductCompanyIds } from '@/lib/product-company';
import type { Translate, Workspace } from '@/lib/types';
import { orderErrorMessage, statusOptions } from './order-ui';
import s from './CustomerOrdersDialog.module.css';

type Props = {
  readOnly?: boolean;
  customerId: string;
  totalUnits?: number;
  productId?: string;
  data: Workspace;
  update: (next: Workspace) => Promise<boolean>;
  notify: (message: string) => void;
  onClose: () => void;
  t: Translate;
};

export default function CustomerOrdersDialog({
  readOnly,
  customerId,
  totalUnits,
  productId,
  data,
  update,
  notify,
  onClose,
  t,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const [deleting, setDeleting] = useState<Order | null>(null);
  const returnFocus = useRef<HTMLElement[]>([]);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState('');
  const titleId = useId();
  const nameId = useId();
  const fieldId = useId();
  const [initialCompany] = useState(
    () => data.customers.find((item) => item.id === customerId)?.companyId,
  );
  const customer = data.customers.find(
    (item) => item.id === customerId && !item.deletedAt && item.companyId === initialCompany,
  );
  const suggestedId =
    productId ?? (customer?.productIds?.length === 1 ? customer.productIds[0] : undefined);
  const product = suggestedId ? data.products.find((item) => item.id === suggestedId) : undefined;
  const availableProduct =
    product &&
    !product.deletedAt &&
    customer &&
    effectiveProductCompanyIds(product, data.posts).includes(customer.companyId)
      ? product
      : undefined;
  const canAdd = !!customer && (!productId || !!availableProduct);
  const parsed = /^\d+$/.test(quantity) ? Number(quantity) : 0;
  const valid = parsed >= 1 && parsed <= MAX_ORDER_QUANTITY;
  const history = useMemo(() => customerProductOrderHistory(data, customerId), [data, customerId]);
  const unitsText = (units: number) =>
    t(
      `${units.toLocaleString('en-US')} ${units === 1 ? 'unit' : 'units'}`,
      `${units.toLocaleString('en-US')} ชิ้น`,
    );

  useLayoutEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    if (window.matchMedia('(pointer: fine)').matches)
      element
        ?.querySelector<HTMLInputElement>('input:not(:disabled)')
        ?.focus({ preventScroll: true });
    return () => {
      if (element?.open) element.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  async function addOrder(event: FormEvent) {
    event.preventDefault();
    if (saving.current || !valid || !canAdd) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const next = prepareCustomerQuantityOrder(data, customerId, availableProduct?.id, parsed);
      if (!(await update(next))) throw new Error('save');
      notify(t('Order added.', 'เพิ่มออเดอร์แล้ว'));
      setQuantity('');
    } catch {
      setError(
        t(
          'Could not add this order. Review the quantity and try again.',
          'เพิ่มออเดอร์ไม่สำเร็จ โปรดตรวจสอบจำนวนแล้วลองอีกครั้ง',
        ),
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function requestDelete(order: Order, button: HTMLButtonElement) {
    const actions = Array.from(
      dialog.current?.querySelectorAll<HTMLButtonElement>('button[data-delete-order]') ?? [],
    );
    const index = actions.indexOf(button);
    returnFocus.current = [
      button,
      actions[index + 1],
      actions[index - 1],
      historyHeading.current,
    ].filter((element) => element != null);
    setDeleting(order);
  }

  useLayoutEffect(() => {
    if (deleting || !returnFocus.current.length) return;
    returnFocus.current.find((element) => element.isConnected)?.focus({ preventScroll: true });
    returnFocus.current = [];
  }, [deleting]);

  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      aria-labelledby={titleId}
      aria-describedby={nameId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        if (!saving.current) onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving.current) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || saving.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <header className={s.header}>
        <div>
          <h2 id={titleId}>{t('Customer orders', 'ออเดอร์ของลูกค้า')}</h2>
          <p id={nameId} className={s.customerName}>
            {customer?.name ?? t('Customer unavailable', 'ไม่พบข้อมูลลูกค้า')}
          </p>
        </div>
        <button
          type="button"
          className={s.close}
          aria-label={t('Close order history', 'ปิดประวัติออเดอร์')}
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className={s.body}>
        <div className={s.summary}>
          <span className={s.summaryLabel}>
            <Box size={20} aria-hidden="true" />
            {t('Total quantity', 'จำนวนรวม')}
          </span>
          <strong aria-live="polite">
            {totalUnits !== undefined
              ? unitsText(totalUnits)
              : history.every(({ order }) => order.status === 'cancelled')
                ? unitsText(0)
                : '–'}
          </strong>
        </div>
        {!readOnly && (
          <form className={s.form} onSubmit={addOrder} aria-busy={busy}>
            <label htmlFor={fieldId}>
              <span className={s.sectionHeading}>{t('Quantity', 'จำนวน')}</span>
              {product && (productId || availableProduct) ? (
                <span className={s.product}>· {product.name}</span>
              ) : (
                !!customer?.productIds?.length && (
                  <span className={s.product}>· {t('No specific product', 'ไม่ระบุสินค้า')}</span>
                )
              )}
            </label>
            <div className={s.entry}>
              <div className={s.stepper}>
                <button
                  type="button"
                  className={s.step}
                  disabled={!canAdd || busy || parsed <= 1}
                  aria-label={t('Decrease quantity', 'ลดจำนวน')}
                  onClick={() =>
                    setQuantity(String(Math.max(1, Math.min(MAX_ORDER_QUANTITY, parsed - 1))))
                  }
                >
                  <Minus size={18} aria-hidden="true" />
                </button>
                <input
                  id={fieldId}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]+"
                  required
                  autoComplete="off"
                  maxLength={7}
                  value={quantity}
                  disabled={!canAdd || busy}
                  onFocus={(event) => event.target.select()}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    setError('');
                  }}
                />
                <button
                  type="button"
                  className={s.step}
                  disabled={!canAdd || busy || parsed >= MAX_ORDER_QUANTITY}
                  aria-label={t('Increase quantity', 'เพิ่มจำนวน')}
                  onClick={() => setQuantity(String(Math.min(MAX_ORDER_QUANTITY, parsed + 1)))}
                >
                  <Plus size={18} aria-hidden="true" />
                </button>
              </div>
              <button type="submit" className={s.submit} disabled={!canAdd || busy || !valid}>
                <Plus size={18} aria-hidden="true" />
                {busy ? t('Saving…', 'กำลังบันทึก…') : t('Add order', 'เพิ่มออเดอร์')}
              </button>
            </div>
            {!canAdd && (
              <p className={s.error} role="status">
                {t(
                  'This customer or product is unavailable for new orders.',
                  'ลูกค้าหรือสินค้านี้ไม่พร้อมสำหรับออเดอร์ใหม่',
                )}
              </p>
            )}
            {quantity && !valid && (
              <p className={s.error} role="alert">
                {t(
                  'Enter a whole quantity from 1 to 1,000,000.',
                  'กรอกจำนวนเต็มตั้งแต่ 1 ถึง 1,000,000',
                )}
              </p>
            )}
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
          </form>
        )}
        <section className={s.history}>
          <div className={s.historyHeading}>
            <h3 className={s.sectionHeading} ref={historyHeading} tabIndex={-1}>
              {t('Order history', 'ประวัติออเดอร์')}
            </h3>
            <span className={s.count}>{history.length.toLocaleString('en-US')}</span>
          </div>
          {history.length ? (
            <ul className={s.rows}>
              {history.map(({ order, quantity: amount }) => {
                const status = statusOptions.find((option) => option.value === order.status)!;
                const namedLines = order.items.filter(
                  (line) => line.name && (!order.quantitySource || line.productId),
                );
                return (
                  <li
                    key={order.id}
                    className={s.row}
                    data-cancelled={order.status === 'cancelled' || undefined}
                  >
                    <div className={s.identity}>
                      <strong>{order.number}</strong>
                      <div className={s.meta}>
                        {order.orderedOn ? (
                          <time dateTime={order.orderedOn}>
                            {formatCalendarDate(order.orderedOn)}
                          </time>
                        ) : (
                          <span>{t('Date not recorded', 'ยังไม่ได้บันทึกวันที่')}</span>
                        )}
                        <span className={s.status} data-status={order.status}>
                          {t(status.en, status.th)}
                        </span>
                      </div>
                      {namedLines.length > 0 && (
                        <p className={s.line}>
                          {namedLines
                            .map((line) =>
                              order.items.length > 1
                                ? `${line.name} × ${line.quantity.toLocaleString('en-US')}`
                                : line.name,
                            )
                            .join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className={s.rowActions}>
                      <span className={s.amount}>
                        {order.items.length
                          ? unitsText(amount)
                          : t('Quantity not recorded', 'ยังไม่ได้บันทึกจำนวน')}
                      </span>
                      {!readOnly && !order.shipment && (
                        <button
                          type="button"
                          className={s.deleteOrder}
                          data-delete-order
                          aria-label={t(
                            `Delete order ${order.number}`,
                            `ลบออเดอร์ ${order.number}`,
                          )}
                          title={t('Delete order', 'ลบออเดอร์')}
                          disabled={busy || !customer}
                          aria-haspopup="dialog"
                          onClick={(event) => requestDelete(order, event.currentTarget)}
                        >
                          <Trash2 size={17} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={s.empty}>{t('No orders yet.', 'ยังไม่มีออเดอร์')}</p>
          )}
        </section>
      </div>
      {deleting && (
        <DeleteOrderConfirmation
          data={data}
          order={deleting}
          update={update}
          notify={notify}
          t={t}
          onClose={() => setDeleting(null)}
        />
      )}
    </dialog>
  );
}

function DeleteOrderConfirmation({
  data,
  order,
  update,
  notify,
  onClose,
  t,
}: Pick<Props, 'data' | 'update' | 'notify' | 'onClose' | 't'> & { order: Order }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();
  const descriptionId = useId();

  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus({ preventScroll: true });
    return () => {
      if (element?.open) element.close();
    };
  }, []);

  async function remove() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      if (
        !data.customers.some(
          (customer) =>
            customer.id === order.customerId &&
            customer.companyId === order.companyId &&
            !customer.deletedAt,
        )
      ) {
        setError(
          t(
            'This customer is no longer available in this company.',
            'ไม่พบลูกค้ารายนี้ในบริษัทนี้แล้ว',
          ),
        );
        return;
      }
      const next = prepareOrderTrash(data, order);
      if (!(await update(next))) {
        setError(
          t(
            'Could not move this order to Trash. Please try again.',
            'ย้ายออเดอร์ไปถังขยะไม่สำเร็จ โปรดลองอีกครั้ง',
          ),
        );
        return;
      }
      notify(t('Order moved to Trash.', 'ย้ายออเดอร์ไปถังขยะแล้ว'));
      onClose();
    } catch (cause) {
      setError(orderErrorMessage(cause, t));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className={`${s.dialog} ${s.confirm}`}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        if (!saving.current) onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!saving.current) onClose();
      }}
    >
      <div className={s.confirmBody}>
        <span className={s.trashIcon}>
          <Trash2 size={21} aria-hidden="true" />
        </span>
        <h2 id={titleId}>{t(`Delete order ${order.number}?`, `ลบออเดอร์ ${order.number}?`)}</h2>
        <p id={descriptionId}>
          {t(
            'You can restore it from Trash within 30 days.',
            'คุณสามารถกู้คืนออเดอร์จากถังขยะได้ภายใน 30 วัน',
          )}
        </p>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <div className={s.confirmActions}>
          <button type="button" ref={cancel} disabled={busy} onClick={onClose}>
            {t('Cancel', 'ยกเลิก')}
          </button>
          <button type="button" className={s.confirmDelete} disabled={busy} onClick={remove}>
            {busy ? t('Moving…', 'กำลังย้าย…') : t('Move to Trash', 'ย้ายไปถังขยะ')}
          </button>
        </div>
      </div>
    </dialog>
  );
}
