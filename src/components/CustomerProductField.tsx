'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { Package, Plus, X } from 'lucide-react';
import { sortCatalog } from '@/lib/catalog';
import { safeCatalogImageUrl } from '@/lib/data';
import type { Product, Translate } from '@/lib/types';
import { SelectionControl } from './SelectionDialog';
import s from './CustomerProductField.module.css';

type Props = {
  products: readonly Product[];
  availableIds: readonly string[];
  value: readonly string[];
  onChange: (ids: string[]) => void;
  quantities?: Readonly<Record<string, string>>;
  onQuantityChange?: (id: string, value: string) => void;
  t: Translate;
  disabled?: boolean;
};

export function ProductThumbnail({
  product,
  className,
}: {
  product: Pick<Product, 'name' | 'imageUrl'>;
  className?: string;
}) {
  const url = product.imageUrl;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span className={`${s.image}${className ? ` ${className}` : ''}`}>
      {url && safeCatalogImageUrl(url) && failedUrl !== url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <Package size={22} aria-hidden="true" />
      )}
    </span>
  );
}

function statusLabel(product: Product | undefined, available: boolean, t: Translate) {
  if (!product) return t('Unavailable product', 'ไม่พบสินค้า');
  if (product.deletedAt) return t('In Trash', 'อยู่ในถังขยะ');
  if (!available) return t('Saved selection · another company', 'รายการที่บันทึกไว้ · บริษัทอื่น');
  return '';
}

export default function CustomerProductField({
  products,
  availableIds,
  value,
  onChange,
  quantities,
  onQuantityChange,
  t,
  disabled = false,
}: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const quantityHintId = useId();
  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const available = new Set(availableIds);
  const selected = new Set(value);
  const options = sortCatalog(products)
    .filter(
      (product) => !product.deletedAt && available.has(product.id) && !selected.has(product.id),
    )
    .map((product) => ({
      value: product.id,
      en: product.name,
      th: product.name,
      icon: <ProductThumbnail product={product} />,
    }));

  return (
    <div className={s.field}>
      <div className={s.fieldHeader}>
        <span>{t('Products', 'สินค้า')}</span>
        <SelectionControl
          title={t('Select products', 'เลือกสินค้า')}
          value=""
          options={options}
          t={t}
          searchLabel={t('Search products', 'ค้นหาสินค้า')}
          deferSelection={false}
          onSelect={(id) => onChange([...value, id])}
          trigger={(open, openDialog) => (
            <button
              ref={trigger}
              type="button"
              className={s.trigger}
              aria-haspopup="dialog"
              aria-expanded={open}
              disabled={disabled}
              onClick={openDialog}
            >
              <Plus size={18} aria-hidden="true" />
              {t('Add product', 'เพิ่มสินค้า')}
            </button>
          )}
        />
      </div>
      {value.length > 0 && onQuantityChange && (
        <p id={quantityHintId} className={s.quantityHint}>
          {t(
            'Enter quantities for the products you want to include in the first order.',
            'ระบุจำนวนของสินค้าที่ต้องการใส่ในออเดอร์แรก',
          )}
        </p>
      )}
      {value.length > 0 && (
        <ul className={s.selectedProducts} aria-label={t('Selected products', 'สินค้าที่เลือก')}>
          {value.map((id) => {
            const product = productsById.get(id);
            const name = product?.name ?? t('Unavailable product', 'ไม่พบสินค้า');
            const status = statusLabel(product, available.has(id), t);
            const quantity = quantities && Object.hasOwn(quantities, id) ? quantities[id] : '';
            return (
              <li
                key={id}
                className={s.selectedProduct}
                data-with-quantity={Boolean(onQuantityChange) || undefined}
              >
                <ProductThumbnail product={product ?? { name, imageUrl: '' }} />
                <span className={s.productCopy}>
                  <span>{name}</span>
                  {status && <small>{status}</small>}
                </span>
                {onQuantityChange && (
                  <label className={s.quantity}>
                    <span>{t('Quantity', 'จำนวน')}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="–"
                      value={quantity}
                      aria-label={t(`Quantity for ${name}`, `จำนวนสินค้า ${name}`)}
                      aria-describedby={quantityHintId}
                      disabled={disabled}
                      onChange={(event) => onQuantityChange(id, event.target.value)}
                    />
                  </label>
                )}
                <button
                  type="button"
                  className={s.remove}
                  aria-label={t(`Remove product ${name}`, `นำสินค้า ${name} ออก`)}
                  disabled={disabled}
                  onClick={() => {
                    onChange(value.filter((valueId) => valueId !== id));
                    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
                  }}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
