'use client';

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, GripVertical, Package, Pencil, Plus, Search, X } from 'lucide-react';
import {
  MAX_SORT_ORDER,
  nextSortOrder,
  reorderCompanies,
  sortCatalog,
  validSortOrder,
} from '@/lib/catalog';
import { safeCatalogImageUrl, validateWorkspace } from '@/lib/data';
import { entityEditIsCurrent } from '@/lib/entity-edit';
import { retainCloudinaryImage } from '@/lib/cloudinary-media';
import { productCompanyIdMap } from '@/lib/product-company';
import type { Product, Company, Translate, Workspace } from '@/lib/types';
import BusinessTypeManager from './BusinessTypeManager';
import styles from './WorkspacePanels.module.css';

interface Props {
  kind: 'products' | 'companies';
  data: Workspace;
  companyId: string;
  update: (next: Workspace) => Promise<boolean>;
  t: Translate;
  notify: (message: string) => void;
}
interface Draft {
  id: string;
  name: string;
  imageUrl: string;
  ownerName: string;
  sortOrder: string;
  companyIds: string[];
  businessTypeId: string;
}
interface CompanyDragSession {
  id: string;
  pointerId: number;
  handle: HTMLButtonElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  targetId: string | null;
}

const CatalogImage = memo(function CatalogImage({
  url,
  name,
  product,
}: {
  url: string;
  name: string;
  product: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span className={product ? styles.productImage : styles.companyAvatar}>
      {url && safeCatalogImageUrl(url) && failedUrl !== url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
        />
      ) : product ? (
        <Package size={32} aria-hidden="true" />
      ) : (
        <span aria-hidden="true">{name.trim().slice(0, 2).toUpperCase() || 'V'}</span>
      )}
    </span>
  );
});

/** Both catalogs use the same validated, revision-checked workspace repository. */
export default function CatalogPanel({ kind, data, update, t, notify, companyId }: Props) {
  const isProduct = kind === 'products';
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<Product | Company | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const [draggingCompanyId, setDraggingCompanyId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [orderMessage, setOrderMessage] = useState('');
  const busyRef = useRef(false);
  const companyGridRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<CompanyDragSession | null>(null);
  const dragGhostRef = useRef<HTMLDivElement>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const beforeReorderRef = useRef<Map<string, DOMRect> | null>(null);
  const reorderAnimationsRef = useRef<Map<string, Animation>>(new Map());
  const editorRef = useRef<HTMLFormElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeEditor = () => {
    setDraft(null);
    setError('');
    requestAnimationFrame(() => {
      const target = previousFocus.current;
      if (target?.isConnected) target.focus();
      else addButtonRef.current?.focus();
    });
  };
  const productCompaniesById = useMemo(
    () => productCompanyIdMap(data.products, data.posts),
    [data.products, data.posts],
  );
  const companyById = useMemo(
    () => new Map(data.companies.map((company) => [company.id, company])),
    [data.companies],
  );
  const typeById = useMemo(
    () => new Map(data.businessTypes.map((type) => [type.id, type])),
    [data.businessTypes],
  );
  const orderedCompanies = useMemo(() => sortCatalog(data.companies), [data.companies]);
  const orderedTypes = useMemo(() => sortCatalog(data.businessTypes), [data.businessTypes]);
  const items: (Product | Company)[] = useMemo(
    () => (isProduct ? data.products.filter((item) => !item.deletedAt) : orderedCompanies),
    [isProduct, data.products, orderedCompanies],
  );
  // Sorting and resolving company names depend on catalog data, not the typed query.
  const searchableItems = useMemo(() => {
    return (isProduct ? sortCatalog(items) : items)
      .filter(
        (item) =>
          !('imageUrl' in item) ||
          companyId === 'all' ||
          productCompaniesById.get(item.id)?.includes(companyId),
      )
      .map((item) => {
        const companyNames =
          'imageUrl' in item
            ? (productCompaniesById.get(item.id) ?? [])
                .map((id) => companyById.get(id)?.name ?? '')
                .join(' ')
            : '';
        return {
          item,
          text: `${item.name} ${'ownerName' in item ? item.ownerName : ''} ${companyNames}`.toLocaleLowerCase(),
        };
      });
  }, [isProduct, items, productCompaniesById, companyById, companyId]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return searchableItems.filter(({ text }) => text.includes(needle)).map(({ item }) => item);
  }, [searchableItems, query]);
  const canReorderCompanies =
    !isProduct && data.companies.length > 1 && !draft && !busy && !query.trim();
  const clearDrag = useCallback(() => {
    const session = dragSessionRef.current;
    dragSessionRef.current = null;
    if (autoScrollFrameRef.current !== null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
    if (session?.handle.hasPointerCapture(session.pointerId))
      session.handle.releasePointerCapture(session.pointerId);
    setDraggingCompanyId(null);
    setDropTargetId(null);
  }, []);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragSessionRef.current) return;
      event.preventDefault();
      clearDrag();
      setOrderMessage(t('Company move canceled.', 'ยกเลิกการย้ายบริษัทแล้ว'));
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [clearDrag, t]);
  useEffect(
    () => () => {
      if (autoScrollFrameRef.current !== null) cancelAnimationFrame(autoScrollFrameRef.current);
      const session = dragSessionRef.current;
      dragSessionRef.current = null;
      if (session?.handle.hasPointerCapture(session.pointerId))
        session.handle.releasePointerCapture(session.pointerId);
    },
    [],
  );
  useLayoutEffect(() => {
    const before = beforeReorderRef.current;
    if (!before || isProduct) return;
    beforeReorderRef.current = null;
    for (const animation of reorderAnimationsRef.current.values()) animation.cancel();
    reorderAnimationsRef.current.clear();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    companyGridRef.current
      ?.querySelectorAll<HTMLElement>('[data-company-card-id]')
      .forEach((card) => {
        const oldRect = before.get(card.dataset.companyCardId ?? '');
        if (!oldRect) return;
        const nextRect = card.getBoundingClientRect();
        const x = oldRect.left - nextRect.left;
        const y = oldRect.top - nextRect.top;
        if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
        const animation = card.animate(
          [{ transform: `translate3d(${x}px, ${y}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
          { duration: 250, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        );
        const id = card.dataset.companyCardId ?? '';
        reorderAnimationsRef.current.set(id, animation);
        animation.onfinish = () => {
          if (reorderAnimationsRef.current.get(id) === animation)
            reorderAnimationsRef.current.delete(id);
        };
      });
  }, [data.companies, isProduct]);
  const findDropTarget = (x: number, y: number): string | null => {
    const grid = companyGridRef.current;
    if (!grid) return null;
    const bounds = grid.getBoundingClientRect();
    if (
      x < bounds.left - 24 ||
      x > bounds.right + 24 ||
      y < bounds.top - 24 ||
      y > bounds.bottom + 24
    )
      return null;
    const direct = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>(
      '[data-company-card-id]',
    );
    if (direct && grid.contains(direct)) return direct.dataset.companyCardId ?? null;
    let closest: string | null = null;
    let distance = Infinity;
    grid.querySelectorAll<HTMLElement>('[data-company-card-id]').forEach((card) => {
      const rect = card.getBoundingClientRect();
      const squared =
        (x - (rect.left + rect.right) / 2) ** 2 + (y - (rect.top + rect.bottom) / 2) ** 2;
      if (squared < distance) {
        distance = squared;
        closest = card.dataset.companyCardId ?? null;
      }
    });
    return closest;
  };
  const moveGhost = (x: number, y: number) => {
    const ghost = dragGhostRef.current;
    if (!ghost) return;
    const { width, height } = ghost.getBoundingClientRect();
    const left = Math.max(12, Math.min(x + 12, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(y + 12, window.innerHeight - height - 12));
    ghost.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  };
  useLayoutEffect(() => {
    const session = dragSessionRef.current;
    if (session?.active) moveGhost(session.x, session.y);
  }, [draggingCompanyId]);
  const updateDropTarget = (session: CompanyDragSession) => {
    const target = findDropTarget(session.x, session.y);
    const targetId = target === session.id ? null : target;
    if (targetId !== session.targetId) {
      session.targetId = targetId;
      setDropTargetId(targetId);
    }
  };
  const autoScroll = () => {
    autoScrollFrameRef.current = null;
    const session = dragSessionRef.current;
    if (!session?.active) return;
    const edge = Math.min(96, Math.max(48, window.innerHeight * 0.15));
    const speed =
      session.y < edge
        ? -Math.min(18, ((edge - session.y) / edge) * 18)
        : session.y > window.innerHeight - edge
          ? Math.min(18, ((session.y - (window.innerHeight - edge)) / edge) * 18)
          : 0;
    if (!speed) return;
    const previousScroll = window.scrollY;
    window.scrollBy(0, speed);
    updateDropTarget(session);
    if (window.scrollY === previousScroll) return;
    autoScrollFrameRef.current = requestAnimationFrame(autoScroll);
  };
  const saveCompanyOrder = async (sourceId: string, targetId: string) => {
    if (busyRef.current || draft || query.trim() || isProduct || sourceId === targetId) return;
    const ordered = sortCatalog(data.companies);
    const targetIndex = ordered.findIndex((store) => store.id === targetId);
    const source = ordered.find((store) => store.id === sourceId);
    if (!source || targetIndex < 0) return;
    const companies = reorderCompanies(data.companies, sourceId, targetId);
    beforeReorderRef.current = new Map(
      [
        ...(companyGridRef.current?.querySelectorAll<HTMLElement>('[data-company-card-id]') ?? []),
      ].map((card) => [card.dataset.companyCardId ?? '', card.getBoundingClientRect()]),
    );
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      if (!(await update({ ...data, companies }))) {
        beforeReorderRef.current = null;
        setError(
          t(
            'Could not save the company order. Try again.',
            'บันทึกลำดับบริษัทไม่สำเร็จ โปรดลองอีกครั้ง',
          ),
        );
        return;
      }
      const position = companies.findIndex((store) => store.id === sourceId) + 1;
      setOrderMessage(
        t(
          `${source.name} is now position ${position} of ${companies.length}.`,
          `${source.name} อยู่ลำดับที่ ${position} จาก ${companies.length} บริษัท`,
        ),
      );
      notify(t('Company order saved.', 'บันทึกลำดับบริษัทแล้ว'));
    } catch {
      beforeReorderRef.current = null;
      setError(
        t(
          'Could not save the company order. Try again.',
          'บันทึกลำดับบริษัทไม่สำเร็จ โปรดลองอีกครั้ง',
        ),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const startCompanyDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (
      !canReorderCompanies ||
      busyRef.current ||
      dragSessionRef.current ||
      (event.pointerType === 'mouse' && event.button !== 0)
    )
      return;
    event.currentTarget.focus();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragSessionRef.current = {
      id,
      pointerId: event.pointerId,
      handle: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      targetId: null,
    };
  };
  const moveCompanyDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    session.x = event.clientX;
    session.y = event.clientY;
    if (!session.active) {
      if (Math.hypot(session.x - session.startX, session.y - session.startY) < 7) return;
      session.active = true;
      setDraggingCompanyId(session.id);
      setError('');
    }
    event.preventDefault();
    moveGhost(session.x, session.y);
    updateDropTarget(session);
    if (autoScrollFrameRef.current === null)
      autoScrollFrameRef.current = requestAnimationFrame(autoScroll);
  };
  const endCompanyDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const target = session.active ? findDropTarget(event.clientX, event.clientY) : null;
    clearDrag();
    if (target && target !== session.id) void saveCompanyOrder(session.id, target);
  };
  const cancelCompanyDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = dragSessionRef.current;
    if (session?.pointerId === event.pointerId && session.handle === event.currentTarget)
      clearDrag();
  };
  const moveCompanyWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    if (!canReorderCompanies || busyRef.current) return;
    const direction =
      event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowDown' || event.key === 'ArrowRight'
          ? 1
          : 0;
    if (!direction) return;
    event.preventDefault();
    const ordered = sortCatalog(data.companies);
    const index = ordered.findIndex((store) => store.id === id);
    const target = ordered[index + direction];
    if (target) void saveCompanyOrder(id, target.id);
  };
  const begin = (item?: Product | Company) => {
    if (busyRef.current || dragSessionRef.current) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    setBaseline(item ? { ...item } : null);
    setDraft({
      id: item?.id ?? crypto.randomUUID(),
      name: item?.name ?? '',
      imageUrl: item ? ('imageUrl' in item ? item.imageUrl : item.logoImageUrl) : '',
      ownerName: item && 'ownerName' in item ? item.ownerName : '',
      businessTypeId:
        item && 'businessTypeId' in item
          ? item.businessTypeId
          : (data.businessTypes.find((type) => type.id === 'other')?.id ??
            data.businessTypes[0]?.id ??
            ''),
      sortOrder: String(item?.sortOrder ?? nextSortOrder(items)),
      companyIds:
        item && 'imageUrl' in item
          ? (productCompaniesById.get(item.id) ?? [])
          : companyId !== 'all' && data.companies.some((store) => store.id === companyId)
            ? [companyId]
            : data.companies.length === 1
              ? [data.companies[0].id]
              : [],
    });
    setError('');
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ block: 'start' });
      editorRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    });
  };

  const commit = async (deleting = false) => {
    if (!draft || busyRef.current) return;
    const current = (isProduct ? data.products : data.companies).find(
      (item) => item.id === draft.id,
    );
    if (!entityEditIsCurrent<Product | Company>(baseline, current)) {
      setError(
        t(
          'This item changed in another tab. Your edits are still here; reopen the latest item before saving.',
          'รายการนี้ถูกแก้ไขในแท็บอื่น การแก้ไขของคุณยังอยู่ที่นี่ โปรดเปิดรายการล่าสุดก่อนบันทึก',
        ),
      );
      return;
    }
    const name = draft.name.trim();
    const imageUrl = draft.imageUrl.trim();
    const order = Number(draft.sortOrder);
    if (
      !deleting &&
      (!name || !draft.sortOrder.trim() || !validSortOrder(order) || !safeCatalogImageUrl(imageUrl))
    ) {
      setError(
        isProduct
          ? t(
              'Enter a name, an HTTPS image URL (or leave it blank), and a whole sort number from 0 to 1,000,000.',
              'กรอกชื่อ ลิงก์รูปภาพ HTTPS (หรือเว้นว่าง) และลำดับเป็นจำนวนเต็มตั้งแต่ 0 ถึง 1,000,000',
            )
          : t(
              'Enter a company name and an HTTPS logo URL (or leave it blank).',
              'กรอกชื่อบริษัทและลิงก์โลโก้ HTTPS (หรือเว้นว่าง)',
            ),
      );
      return;
    }
    if (isProduct && !deleting && draft.companyIds.length === 0) {
      setError(
        t(
          'Select at least one company for this product.',
          'เลือกบริษัทอย่างน้อยหนึ่งบริษัทสำหรับสินค้านี้',
        ),
      );
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      let next: Workspace;
      if (isProduct) {
        if (deleting && (!current || !('imageUrl' in current))) return;
        const product: Product = deleting
          ? { ...(current as Product), deletedAt: new Date().toISOString() }
          : {
              ...((baseline as Product | null) ?? {}),
              id: draft.id,
              name,
              imageUrl,
              sortOrder: order,
              companyIds: draft.companyIds,
              imageAsset: retainCloudinaryImage((baseline as Product | null)?.imageAsset, imageUrl),
            };
        next = {
          ...data,
          products: current
            ? data.products.map((item) => (item.id === product.id ? product : item))
            : [...data.products, product],
        };
      } else {
        const store: Company = {
          ...((baseline as Company | null) ?? {
            initials: name.slice(0, 2).toUpperCase(),
            color: '#263b4b',
            description: '',
          }),
          id: draft.id,
          name,
          logoImageUrl: imageUrl,
          logoAsset: retainCloudinaryImage((baseline as Company | null)?.logoAsset, imageUrl),
          ownerName: draft.ownerName.trim(),
          businessTypeId: draft.businessTypeId,
          sortOrder: order,
        };
        next = {
          ...data,
          companies: current
            ? data.companies.map((item) => (item.id === store.id ? store : item))
            : [...data.companies, store],
        };
      }
      validateWorkspace(next);
      if (!(await update(next))) {
        setError(
          t(
            'Could not save. Your edits are still here. Try again after checking the workspace message.',
            'บันทึกไม่สำเร็จ การแก้ไขของคุณยังอยู่ โปรดตรวจสอบข้อความของพื้นที่ทำงานแล้วลองอีกครั้ง',
          ),
        );
        return;
      }
      setQuery('');
      closeEditor();
      notify(
        deleting
          ? t(
              'Product moved to Trash. Restore it within 30 days.',
              'ย้ายสินค้าไปถังขยะแล้ว กู้คืนได้ภายใน 30 วัน',
            )
          : isProduct
            ? t('Product saved.', 'บันทึกสินค้าแล้ว')
            : t('Company saved.', 'บันทึกบริษัทแล้ว'),
      );
    } catch {
      setError(
        t(
          'Could not save this item. Check the fields and try again. Your edits are still here.',
          'บันทึกรายการไม่สำเร็จ ตรวจสอบข้อมูลแล้วลองอีกครั้ง การแก้ไขของคุณยังอยู่',
        ),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void commit();
  };

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div>
          <h2>
            {isProduct ? t('Your products', 'สินค้าของคุณ') : t('Your companies', 'บริษัทของคุณ')}
          </h2>
          <p id={isProduct ? undefined : 'company-order-instructions'}>
            {isProduct
              ? t(
                  'Link each product to the companies that offer it.',
                  'เชื่อมสินค้าแต่ละรายการกับบริษัทที่จำหน่าย',
                )
              : t(
                  'Drag the handle to reorder companies, or focus it and use arrow keys.',
                  'ลากปุ่มจับเพื่อจัดลำดับบริษัท หรือใช้ปุ่มลูกศรเมื่อโฟกัสอยู่',
                )}
          </p>
        </div>
        <div className={styles.catalogActions}>
          {!isProduct && (
            <button
              className={styles.secondaryButton}
              disabled={busy}
              onClick={() => setTypesOpen(true)}
            >
              {t('Business types', 'ประเภทธุรกิจ')}
            </button>
          )}
          <button
            ref={addButtonRef}
            className={styles.primaryButton}
            disabled={busy || !!draft}
            onClick={() => begin()}
          >
            <Plus size={19} />
            {isProduct ? t('Add product', 'เพิ่มสินค้า') : t('Add company', 'เพิ่มบริษัท')}
          </button>
        </div>
      </div>
      <label className={styles.search}>
        <Search size={19} aria-hidden="true" />
        <input
          aria-label={
            isProduct ? t('Search products', 'ค้นหาสินค้า') : t('Search companies', 'ค้นหาบริษัท')
          }
          placeholder={
            isProduct
              ? t('Search products…', 'ค้นหาสินค้า…')
              : t('Search companies or owners…', 'ค้นหาบริษัทหรือเจ้าของบริษัท…')
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span>{visible.length}</span>
      </label>
      {!isProduct && query.trim() && (
        <p className={styles.reorderHint}>
          {t('Clear search to reorder companies.', 'ล้างคำค้นหาก่อนจัดลำดับบริษัท')}
        </p>
      )}
      {!isProduct && !draft && error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!isProduct && (
        <span className={styles.visuallyHidden} role="status">
          {orderMessage}
        </span>
      )}
      {draft && (
        <form
          ref={editorRef}
          className={`${styles.editor} ${styles.catalogEditor}`}
          onSubmit={save}
          aria-busy={busy}
        >
          <div className={styles.sectionHeading}>
            <h3>
              {isProduct
                ? baseline
                  ? t('Edit product', 'แก้ไขสินค้า')
                  : t('Add product', 'เพิ่มสินค้า')
                : baseline
                  ? t('Edit company', 'แก้ไขบริษัท')
                  : t('Add company', 'เพิ่มบริษัท')}
            </h3>
            <button
              type="button"
              className={styles.iconButton}
              disabled={busy}
              aria-label={t('Close editor', 'ปิดการแก้ไข')}
              onClick={closeEditor}
            >
              <X size={20} />
            </button>
          </div>
          <fieldset className={`${styles.formGrid} ${styles.catalogFields}`} disabled={busy}>
            <legend className={styles.visuallyHidden}>
              {isProduct
                ? t('Product details', 'ข้อมูลสินค้า')
                : t('Company details', 'ข้อมูลบริษัท')}
            </legend>
            <label className={isProduct ? styles.fullWidth : undefined}>
              {isProduct ? t('Product name', 'ชื่อสินค้า') : t('Company name', 'ชื่อบริษัท')}
              <input
                required
                maxLength={isProduct ? 200 : 100}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            {isProduct && (
              <fieldset className={`${styles.productCompanies} ${styles.fullWidth}`}>
                <legend>{t('Companies for this product', 'บริษัทของสินค้านี้')}</legend>
                <div className={styles.productCompanyOptions}>
                  {orderedCompanies.map((store) => (
                    <label key={store.id} className={styles.productCompanyOption}>
                      <input
                        type="checkbox"
                        checked={draft.companyIds.includes(store.id)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            companyIds: event.target.checked
                              ? [...draft.companyIds, store.id]
                              : draft.companyIds.filter((id) => id !== store.id),
                          })
                        }
                      />
                      <span>{store.name}</span>
                    </label>
                  ))}
                </div>
                <small>
                  {t(
                    'Select every company that offers this product.',
                    'เลือกบริษัททุกบริษัทที่จำหน่ายสินค้านี้',
                  )}
                </small>
              </fieldset>
            )}
            {!isProduct && (
              <label>
                {t('Business type', 'ประเภทธุรกิจ')}
                <select
                  required
                  value={draft.businessTypeId}
                  onChange={(event) => setDraft({ ...draft, businessTypeId: event.target.value })}
                >
                  {orderedTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {t(type.name, type.nameTh || type.name)}
                    </option>
                  ))}
                </select>
                <small>
                  {t(
                    'Sets the customer details available for this company.',
                    'กำหนดข้อมูลลูกค้าที่ใช้สำหรับบริษัทนี้',
                  )}
                </small>
              </label>
            )}
            {!isProduct && (
              <label>
                {t('Owner name', 'ชื่อเจ้าของบริษัท')}
                <input
                  maxLength={100}
                  value={draft.ownerName}
                  onChange={(event) => setDraft({ ...draft, ownerName: event.target.value })}
                />
              </label>
            )}
            <label>
              {isProduct ? t('Image URL', 'ลิงก์รูปสินค้า') : t('Logo image URL', 'ลิงก์รูปโลโก้')}
              <input
                type="text"
                inputMode="url"
                maxLength={2048}
                placeholder="https://…"
                value={draft.imageUrl}
                onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })}
              />
              <small>
                {t(
                  'Optional · use an HTTPS link or keep the supplied image path.',
                  'ไม่บังคับ · ใช้ลิงก์ HTTPS หรือเก็บพาธรูปภาพที่ให้มาไว้',
                )}
              </small>
            </label>
            {isProduct && (
              <label>
                {t('Sort order', 'ลำดับการแสดงผล')}
                <input
                  required
                  type="number"
                  min={0}
                  max={MAX_SORT_ORDER}
                  step={1}
                  value={draft.sortOrder}
                  onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
                />
                <small>{t('Lower numbers appear first.', 'ตัวเลขน้อยแสดงก่อน')}</small>
              </label>
            )}
          </fieldset>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.formActions}>
            {isProduct && baseline && (
              <button
                type="button"
                className={styles.catalogDelete}
                disabled={busy}
                onClick={() => void commit(true)}
              >
                {t('Delete product', 'ลบสินค้า')}
              </button>
            )}
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={busy}
              onClick={closeEditor}
            >
              {t('Cancel', 'ยกเลิก')}
            </button>
            <button type="submit" className={styles.primaryButton} disabled={busy}>
              <Check size={18} />
              {busy ? t('Saving…', 'กำลังบันทึก…') : t('Save', 'บันทึก')}
            </button>
          </div>
        </form>
      )}
      {visible.length ? (
        <div className={styles.cardGrid} ref={companyGridRef}>
          {visible.map((item, index) => (
            <article
              className={`${styles.companyCard} ${!isProduct && draggingCompanyId === item.id ? styles.companyCardDragging : ''} ${!isProduct && dropTargetId === item.id ? styles.companyCardTarget : ''}`}
              key={item.id}
              data-company-card-id={isProduct ? undefined : item.id}
            >
              <div className={styles.cardTop}>
                {isProduct ? (
                  <span className={styles.muted}>
                    {t('Order', 'ลำดับ')} {item.sortOrder}
                  </span>
                ) : (
                  <span className={styles.positionBadge}>
                    <span className={styles.visuallyHidden}>{t('Position', 'ลำดับที่')} </span>
                    {index + 1}
                  </span>
                )}
                {!isProduct && (
                  <button
                    type="button"
                    className={`${styles.iconButton} ${styles.companyDragHandle}`}
                    aria-label={t(
                      `Reorder ${item.name}. Use arrow keys to move it.`,
                      `จัดลำดับ ${item.name} ใช้ปุ่มลูกศรเพื่อย้าย`,
                    )}
                    aria-describedby="company-order-instructions"
                    aria-disabled={!canReorderCompanies}
                    title={t('Drag to reorder', 'ลากเพื่อจัดลำดับ')}
                    onPointerDown={(event) => startCompanyDrag(event, item.id)}
                    onPointerMove={moveCompanyDrag}
                    onPointerUp={endCompanyDrag}
                    onPointerCancel={cancelCompanyDrag}
                    onLostPointerCapture={cancelCompanyDrag}
                    onKeyDown={(event) => moveCompanyWithKeyboard(event, item.id)}
                  >
                    <GripVertical size={19} aria-hidden="true" />
                  </button>
                )}
              </div>
              <CatalogImage
                url={'imageUrl' in item ? item.imageUrl : item.logoImageUrl}
                name={item.name}
                product={isProduct}
              />
              <h3 className={styles.catalogName}>{item.name}</h3>
              {'businessTypeId' in item && (
                <span className={styles.companyType}>
                  {(() => {
                    const type = typeById.get(item.businessTypeId);
                    return type ? t(type.name, type.nameTh || type.name) : '';
                  })()}
                </span>
              )}
              {'imageUrl' in item && (
                <div className={styles.productCompanyNames}>
                  <strong className={styles.productCompanyLabel}>{t('Companies', 'บริษัท')}</strong>
                  {(productCompaniesById.get(item.id) ?? []).length ? (
                    (productCompaniesById.get(item.id) ?? []).map((id) => {
                      const store = companyById.get(id);
                      return store ? <span key={id}>{store.name}</span> : null;
                    })
                  ) : (
                    <span className={styles.unassignedCompany}>
                      {t('Company not assigned', 'ยังไม่ได้กำหนดบริษัท')}
                    </span>
                  )}
                </div>
              )}
              {'ownerName' in item && item.ownerName && (
                <p>
                  {t('Owner', 'เจ้าของบริษัท')}: {item.ownerName}
                </p>
              )}
              <button
                className={`${styles.companyEdit} ${styles.catalogEdit}`}
                disabled={busy || !!draft}
                aria-label={`${t('Edit', 'แก้ไข')} ${item.name}`}
                onClick={() => begin(item)}
              >
                {isProduct ? t('Edit product', 'แก้ไขสินค้า') : t('Edit company', 'แก้ไขบริษัท')}
                <Pencil size={17} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <Package size={28} />
          </span>
          <h3>
            {query
              ? t('No matching items', 'ไม่พบรายการที่ค้นหา')
              : isProduct && companyId !== 'all'
                ? t('No products for this company', 'ยังไม่มีสินค้าสำหรับบริษัทนี้')
                : isProduct
                  ? t('Add your first product', 'เพิ่มสินค้ารายการแรก')
                  : t('Add your first company', 'เพิ่มบริษัทแรก')}
          </h3>
          <p>
            {query
              ? isProduct
                ? t('Try a different name or company.', 'ลองค้นด้วยชื่อหรือบริษัทอื่น')
                : t('Try a different name or owner.', 'ลองค้นด้วยชื่อบริษัทหรือเจ้าของอื่น')
              : isProduct
                ? t(
                    'Add a product and choose the companies that offer it.',
                    'เพิ่มสินค้าและเลือกบริษัทที่จำหน่าย',
                  )
                : t(
                    'Add a company to organize your catalog.',
                    'เพิ่มบริษัทเพื่อจัดการรายการสินค้า',
                  )}
          </p>
        </div>
      )}
      {draggingCompanyId &&
        dragSessionRef.current &&
        createPortal(
          <div ref={dragGhostRef} className={styles.companyDragGhost} aria-hidden="true">
            <GripVertical size={18} />
            <strong>{companyById.get(draggingCompanyId)?.name}</strong>
          </div>,
          document.body,
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
