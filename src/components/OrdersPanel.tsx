'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import {
  CheckCircle2,
  FileText,
  Package,
  Plus,
  Search,
  Settings2,
  ShoppingBag,
  Truck,
  X,
} from 'lucide-react';
import type { Translate, Workspace } from '@/lib/types';
import { defaultShippingSettings, formatMoneySatang, orderTotals, type Order } from '@/lib/orders';
import { formatCalendarDate } from '@/lib/calendar';
import { SelectionControl } from './SelectionDialog';
import SelectionField from './SelectionField';
import OrderEditor from './OrderEditor';
import { carrierOptions, statusOptions } from './order-ui';
import s from './OrdersPanel.module.css';

export interface OrdersProps {
  data: Workspace;
  companyId: string;
  update: (next: Workspace) => Promise<boolean>;
  t: Translate;
  notify: (message: string) => void;
}

export default function OrdersPanel(props: OrdersProps) {
  const { data, companyId, t, update, notify } = props;
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim().toLocaleLowerCase());
  const [status, setStatus] = useState('all');
  const [carrier, setCarrier] = useState('all');
  const [editing, setEditing] = useState<Order | 'new' | null>(null);
  const settings = data.shippingSettings ?? defaultShippingSettings();
  const orders = useMemo(
    () =>
      (data.orders ?? []).filter(
        (order) => !order.deletedAt && (companyId === 'all' || order.companyId === companyId),
      ),
    [data.orders, companyId],
  );
  const visible = useMemo(
    () =>
      orders
        .filter(
          (order) =>
            (status === 'all' || order.status === status) &&
            (carrier === 'all' || (!order.quantitySource && order.carrier === carrier)) &&
            (!search ||
              [
                order.number,
                order.customerName,
                order.recipient.name,
                order.recipient.phone,
                order.notes,
                ...order.items.map((item) => item.name),
                data.companies.find((company) => company.id === order.companyId)?.name,
              ]
                .join(' ')
                .toLocaleLowerCase()
                .includes(search)),
        )
        .sort(
          (a, b) =>
            b.orderedOn.localeCompare(a.orderedOn) ||
            b.createdAt.localeCompare(a.createdAt) ||
            b.number.localeCompare(a.number),
        ),
    [orders, status, carrier, search, data.companies],
  );
  const businessOrders = orders.filter((order) => order.shipment?.mode !== 'training');
  const stats = [
    {
      label: t('Open orders', 'ออเดอร์ที่รอดำเนินการ'),
      value: businessOrders.filter((order) => !['cancelled', 'completed'].includes(order.status))
        .length,
      icon: ShoppingBag,
    },
    {
      label: t('Shipped', 'จัดส่งแล้ว'),
      value: businessOrders.filter((order) => order.status === 'shipped').length,
      icon: Package,
    },
    {
      label: t('Completed', 'สำเร็จ'),
      value: businessOrders.filter((order) => order.status === 'completed').length,
      icon: CheckCircle2,
    },
    {
      label: t('Order value · THB', 'มูลค่าออเดอร์ · บาท'),
      value: formatMoneySatang(
        businessOrders
          .filter((order) => !order.quantitySource && order.status !== 'cancelled')
          .reduce((total, order) => total + orderTotals(order).totalSatang, 0),
      ),
      icon: FileText,
    },
  ];
  return (
    <div className={s.page}>
      <div className={s.toolbar}>
        <div className={s.actions}>
          <SelectionControl
            title={t('Default carrier', 'ขนส่งเริ่มต้น')}
            options={carrierOptions}
            value={settings.defaultCarrier}
            t={t}
            onSelect={async (defaultCarrier) => {
              if (await update({ ...data, shippingSettings: { ...settings, defaultCarrier } }))
                notify(t('Default carrier saved.', 'บันทึกขนส่งเริ่มต้นแล้ว'));
            }}
            trigger={(open, show) => (
              <button
                className={s.secondaryButton}
                onClick={show}
                aria-haspopup="dialog"
                aria-expanded={open}
              >
                <Settings2 size={18} /> {t('Default carrier', 'ขนส่งเริ่มต้น')}
              </button>
            )}
          />
          <button
            className={s.primaryButton}
            disabled={!data.companies.length}
            onClick={() => setEditing('new')}
          >
            <Plus size={19} />
            {t('New order', 'สร้างออเดอร์')}
          </button>
        </div>
      </div>
      <div className={s.summary}>
        {stats.map(({ label, value, icon: Icon }) => (
          <div className={s.summaryCard} key={label}>
            <span className={s.summaryIcon}>
              <Icon size={23} />
            </span>
            <div>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          </div>
        ))}
      </div>
      <section className={s.results} aria-label={t('Orders', 'ออเดอร์')}>
        <div className={s.filters}>
          <label className={s.search}>
            <Search size={20} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Search orders or customers…', 'ค้นหาออเดอร์หรือลูกค้า…')}
              aria-label={t('Search orders', 'ค้นหาออเดอร์')}
            />
            {query && (
              <button
                className={s.iconButton}
                onClick={() => setQuery('')}
                aria-label={t('Clear search', 'ล้างการค้นหา')}
              >
                <X size={18} />
              </button>
            )}
          </label>
          <SelectionField
            label={t('Status', 'สถานะ')}
            value={status}
            onSelect={setStatus}
            t={t}
            options={[{ value: 'all', en: 'All statuses', th: 'ทุกสถานะ' }, ...statusOptions]}
          />
          <SelectionField
            label={t('Carrier', 'ขนส่ง')}
            value={carrier}
            onSelect={setCarrier}
            t={t}
            options={[{ value: 'all', en: 'All carriers', th: 'ทุกขนส่ง' }, ...carrierOptions]}
          />
        </div>
        {visible.length ? (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>{t('Order / customer', 'ออเดอร์ / ลูกค้า')}</th>
                  <th>{t('Items', 'รายการสินค้า')}</th>
                  <th>{t('Total · THB', 'ยอดรวม · บาท')}</th>
                  <th>{t('Status', 'สถานะ')}</th>
                  <th>{t('Shipping', 'การจัดส่ง')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((order) => {
                  const state = statusOptions.find((option) => option.value === order.status)!;
                  const carrier = carrierOptions.find((option) => option.value === order.carrier)!;
                  return (
                    <tr key={order.id}>
                      <td>
                        <button className={s.orderLink} onClick={() => setEditing(order)}>
                          {order.number}
                        </button>
                        {order.shipment?.mode === 'training' && (
                          <span className={s.status} data-status="training">
                            {t('Test shipment', 'พัสดุทดสอบ')}
                          </span>
                        )}
                        <strong className={s.customerName}>
                          {order.customerName || t('Customer not entered', 'ยังไม่ได้ระบุลูกค้า')}
                        </strong>
                        <span className={s.muted}>
                          {order.orderedOn
                            ? formatCalendarDate(order.orderedOn)
                            : t('Date not recorded', 'ยังไม่ได้บันทึกวันที่')}{' '}
                          · {data.companies.find((company) => company.id === order.companyId)?.name}
                        </span>
                      </td>
                      <td data-label={t('Items', 'สินค้า')}>
                        <span className={s.itemNames}>
                          {order.items
                            .map((item) =>
                              order.quantitySource && !item.productId
                                ? t(
                                    `${item.quantity} ${item.quantity === 1 ? 'unit' : 'units'}`,
                                    `${item.quantity} ชิ้น`,
                                  )
                                : `${item.name} × ${item.quantity}`,
                            )
                            .join(', ') || '—'}
                        </span>
                      </td>
                      <td data-label={t('Total', 'ยอดรวม')}>
                        <strong className={s.amount}>
                          {order.quantitySource
                            ? '—'
                            : formatMoneySatang(orderTotals(order).totalSatang)}
                        </strong>
                      </td>
                      <td data-label={t('Status', 'สถานะ')}>
                        <span className={s.status} data-status={order.status}>
                          {t(state.en, state.th)}
                        </span>
                      </td>
                      <td data-label={t('Shipping', 'การจัดส่ง')}>
                        {order.quantitySource ? (
                          '—'
                        ) : (
                          <span className={s.carrier}>
                            <Truck size={16} />
                            {t(carrier.en, carrier.th)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={s.empty}>
            <span className={s.emptyIcon}>
              <ShoppingBag size={34} />
            </span>
            <h2>
              {orders.length
                ? t('No matching orders', 'ไม่พบออเดอร์ที่ตรงกัน')
                : t('Your first order starts here', 'เริ่มสร้างออเดอร์แรกของคุณ')}
            </h2>
            <p>
              {orders.length
                ? t('Try another search or change the filters.', 'ลองค้นหาใหม่หรือเปลี่ยนตัวกรอง')
                : t(
                    'Add a customer and the items they ordered.',
                    'เพิ่มลูกค้าและสินค้าที่ลูกค้าสั่งซื้อ',
                  )}
            </p>
            <button
              className={s.primaryButton}
              disabled={!orders.length && !data.companies.length}
              onClick={() =>
                orders.length
                  ? (setQuery(''), setStatus('all'), setCarrier('all'))
                  : setEditing('new')
              }
            >
              {orders.length
                ? t('Clear filters', 'ล้างตัวกรอง')
                : t('Create an order', 'สร้างออเดอร์')}
            </button>
          </div>
        )}
        <div className={s.listFooter}>
          <span>
            {t(`${visible.length} orders in this view`, `${visible.length} ออเดอร์ในมุมมองนี้`)}
          </span>
          <span>{t('Saved in this browser', 'บันทึกในเบราว์เซอร์นี้')}</span>
        </div>
      </section>
      {editing && (
        <OrderEditor
          {...props}
          order={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
