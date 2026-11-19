'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  ClipboardList,
  Code2,
  CornerDownLeft,
  FileText,
  LayoutDashboard,
  Package,
  Pin,
  Plus,
  Search,
  Settings2,
  Building2 as CompanyIcon,
  Trash2,
  Users,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Customer, Locale, Post, Translate, View, Workspace } from '@/lib/types';
import { formatCalendarDate } from '@/lib/calendar';
import { reportingDate } from '@/lib/data';
import { sortPosts } from '@/lib/post-tools';
import { sortCatalog } from '@/lib/catalog';
import styles from './QuickSearch.module.css';

interface QuickSearchProps {
  data: Workspace;
  locale: Locale;
  t: Translate;
  onClose: () => void;
  onNavigate: (view: View) => void;
  onOpenPost: (post: Post) => void;
  onOpenCustomer: (customer: Customer) => void;
  onSelectCompany: (id: string) => void;
  onCreatePost: () => void;
}

interface SearchResult {
  key: string;
  label: string;
  detail: string;
  icon: LucideIcon;
  action: () => void;
  color?: string;
  date?: string;
}

interface ResultSection {
  key: string;
  label: string;
  results: SearchResult[];
}

const destinations: { view: View; en: string; th: string; keywords: string; icon: LucideIcon }[] = [
  {
    view: 'overview',
    en: 'Overview',
    th: 'ภาพรวม',
    keywords: 'dashboard home หน้าหลัก',
    icon: LayoutDashboard,
  },
  {
    view: 'posts',
    en: 'Post library',
    th: 'คลังโพสต์',
    keywords: 'published posts links เผยแพร่ ลิงก์โพสต์',
    icon: ClipboardList,
  },
  {
    view: 'groups',
    en: 'Facebook groups',
    th: 'กลุ่ม Facebook',
    keywords: 'communities ชุมชน',
    icon: Users,
  },
  {
    view: 'scripts',
    en: 'Code scripts',
    th: 'คลังสคริปต์',
    keywords: 'javascript code console snippets f12 facebook instagram tiktok โค้ด สคริปต์ คอนโซล',
    icon: Code2,
  },
  {
    view: 'analytics',
    en: 'Performance',
    th: 'ผลลัพธ์',
    keywords: 'analytics viewers totals วิเคราะห์ ผู้ชม ยอดรวม',
    icon: BarChart3,
  },
  {
    view: 'products',
    en: 'Products',
    th: 'สินค้า',
    keywords: 'catalog image สินค้า รูปภาพ',
    icon: Package,
  },
  {
    view: 'companies',
    en: 'Companies',
    th: 'บริษัท',
    keywords: 'business ธุรกิจ',
    icon: CompanyIcon,
  },
  {
    view: 'customers',
    en: 'Customers',
    th: 'ลูกค้า',
    keywords: 'clients contacts domains github ลูกค้า ติดต่อ โดเมน',
    icon: UserRound,
  },
  {
    view: 'settings',
    en: 'Workspace settings',
    th: 'ตั้งค่าพื้นที่ทำงาน',
    keywords: 'backup restore data สำรอง กู้คืน ข้อมูล',
    icon: Settings2,
  },
  { view: 'trash', en: 'Trash', th: 'ถังขยะ', keywords: 'deleted restore ลบ กู้คืน', icon: Trash2 },
];

export default function QuickSearch({
  data,
  locale,
  t,
  onClose,
  onNavigate,
  onOpenPost,
  onOpenCustomer,
  onSelectCompany,
  onCreatePost,
}: QuickSearchProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const choosing = useRef(false);
  const id = useId();
  const listId = `${id}-results`;
  const titleId = `${id}-title`;
  const scopeId = `${id}-scope`;
  const normalized = query.trim().toLocaleLowerCase(locale);
  const companyLookup = useMemo(
    () => new Map(data.companies.map((store) => [store.id, store])),
    [data.companies],
  );
  const groupLookup = useMemo(
    () => new Map(data.groups.map((group) => [group.id, group])),
    [data.groups],
  );
  // Build searchable text/counts and sort only when the underlying data changes.
  // Filtering a pre-sorted list keeps the same pinned/recent order as sorting matches.
  const searchData = useMemo(() => {
    const text = (...values: (string | undefined)[]) => values.join(' ').toLocaleLowerCase(locale);
    const activePosts = data.posts.filter((post) => !post.deletedAt);
    const activeCustomers = data.customers.filter((customer) => !customer.deletedAt);
    const postCounts = new Map<string, number>();
    const customerCounts = new Map<string, number>();
    for (const post of activePosts)
      postCounts.set(post.companyId, (postCounts.get(post.companyId) ?? 0) + 1);
    for (const customer of activeCustomers)
      customerCounts.set(customer.companyId, (customerCounts.get(customer.companyId) ?? 0) + 1);
    return {
      postCounts,
      customerCounts,
      posts: sortPosts(activePosts, 'recent', locale).map((post) => ({
        post,
        text: text(
          post.product,
          companyLookup.get(post.companyId)?.name,
          post.platform === 'facebook' ? groupLookup.get(post.groupId)?.name : undefined,
        ),
      })),
      companies: sortCatalog(data.companies).map((company) => ({
        company,
        text: text(company.name, company.ownerName),
      })),
      customers: activeCustomers.map((customer) => ({
        customer,
        text: text(
          customer.name,
          customer.organization,
          customer.contactName,
          customer.email,
          customer.phone,
          customer.website,
          companyLookup.get(customer.companyId)?.name,
          ...customer.domains.map((domain) => domain.domain),
          ...customer.githubAccounts.flatMap((account) => [
            account.name,
            account.email,
            account.username,
          ]),
          ...customer.socialLinks.map((link) => link.url),
          ...Object.values(customer.fieldValues),
        ),
      })),
    };
  }, [data.posts, data.customers, data.companies, locale, companyLookup, groupLookup]);
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(locale === 'th' ? 'th-TH' : 'en-US'),
    [locale],
  );
  const number = numberFormatter.format;
  // Keep matching synchronous with the input so Enter always opens a current result.
  // Arrow/focus selection changes reuse these sections without rescanning the workspace.
  const sections = useMemo<ResultSection[]>(() => {
    const matches = (...values: (string | undefined)[]) =>
      values.join(' ').toLocaleLowerCase(locale).includes(normalized);
    const dateLabel = (value: string) =>
      value && Number.isFinite(Date.parse(value)) ? formatCalendarDate(reportingDate(value)) : '';
    const quickActions: SearchResult[] = matches(
      'Add existing published post track',
      'เพิ่มโพสต์ เผยแพร่แล้ว ติดตาม',
    )
      ? [
          {
            key: 'create-post',
            label: t('Add post', 'เพิ่มโพสต์'),
            detail: t('Track a post that is already live', 'ติดตามโพสต์ที่เผยแพร่แล้ว'),
            icon: Plus,
            action: onCreatePost,
          },
        ]
      : [];
    const pageResults: SearchResult[] = destinations
      .filter((item) => matches(item.en, item.th, item.keywords))
      .map((item) => ({
        key: `page-${item.view}`,
        label: t(item.en, item.th),
        detail: t('Open page', 'เปิดหน้า'),
        icon: item.icon,
        action: () => onNavigate(item.view),
      }));
    const postResults: SearchResult[] = searchData.posts
      .filter((entry) => entry.text.includes(normalized))
      .slice(0, normalized ? 8 : 4)
      .map(({ post }) => ({
        key: `post-${post.id}`,
        label: post.product || t('Published post', 'โพสต์ที่เผยแพร่แล้ว'),
        detail: [
          post.pinned ? t('Pinned', 'ปักหมุด') : '',
          companyLookup.get(post.companyId)?.name,
          (post.platform === 'facebook' ? groupLookup.get(post.groupId)?.name : '') ||
            post.product ||
            post.platform,
        ]
          .filter(Boolean)
          .join(' · '),
        icon: post.pinned ? Pin : FileText,
        date: dateLabel(post.publishedAt),
        color: companyLookup.get(post.companyId)?.color,
        action: () => onOpenPost(post),
      }));
    const companyResults: SearchResult[] = searchData.companies
      .filter((entry) => entry.text.includes(normalized))
      .slice(0, 6)
      .map(({ company: store }) => ({
        key: `company-${store.id}`,
        label: store.name,
        detail: t(
          `${number(searchData.customerCounts.get(store.id) ?? 0)} customers · ${number(searchData.postCounts.get(store.id) ?? 0)} posts`,
          `${number(searchData.customerCounts.get(store.id) ?? 0)} ลูกค้า · ${number(searchData.postCounts.get(store.id) ?? 0)} โพสต์`,
        ),
        icon: CompanyIcon,
        color: store.color,
        action: () => onSelectCompany(store.id),
      }));
    const customerResults: SearchResult[] = searchData.customers
      .filter((entry) => entry.text.includes(normalized))
      .slice(0, normalized ? 6 : 3)
      .map(({ customer }) => ({
        key: `customer-${customer.id}`,
        label: customer.name,
        detail: [
          companyLookup.get(customer.companyId)?.name,
          customer.organization || customer.email,
        ]
          .filter(Boolean)
          .join(' · '),
        icon: UserRound,
        color: companyLookup.get(customer.companyId)?.color,
        action: () => onOpenCustomer(customer),
      }));
    return (
      normalized
        ? [
            { key: 'actions', label: t('Quick action', 'คำสั่งด่วน'), results: quickActions },
            { key: 'posts', label: t('Posts', 'โพสต์'), results: postResults },
            { key: 'companies', label: t('Companies', 'บริษัท'), results: companyResults },
            { key: 'customers', label: t('Customers', 'ลูกค้า'), results: customerResults },
            { key: 'pages', label: t('Go to', 'ไปที่'), results: pageResults },
          ]
        : [
            { key: 'actions', label: t('Quick action', 'คำสั่งด่วน'), results: quickActions },
            { key: 'pages', label: t('Go to', 'ไปที่'), results: pageResults },
            {
              key: 'posts',
              label: t('Pinned & recent posts', 'โพสต์ที่ปักหมุดและโพสต์ล่าสุด'),
              results: postResults,
            },
            { key: 'companies', label: t('Companies', 'บริษัท'), results: companyResults },
            { key: 'customers', label: t('Customers', 'ลูกค้า'), results: customerResults },
          ]
    ).filter((section) => section.results.length > 0);
  }, [
    normalized,
    locale,
    t,
    searchData,
    companyLookup,
    groupLookup,
    number,
    onCreatePost,
    onNavigate,
    onOpenPost,
    onSelectCompany,
    onOpenCustomer,
  ]);
  const results = useMemo(() => sections.flatMap((section) => section.results), [sections]);
  const selectedIndex = Math.min(activeIndex, Math.max(0, results.length - 1));
  const activeId = results.length ? `${id}-option-${selectedIndex}` : undefined;

  useLayoutEffect(() => {
    const element = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (element && !element.open) element.showModal();
    inputRef.current?.focus();
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    resultRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, normalized]);

  function choose(result: SearchResult) {
    if (choosing.current) return;
    choosing.current = true;
    dialogRef.current?.close();
    onClose();
    // Let the dialog unmount and restore focus before opening the destination.
    requestAnimationFrame(result.action);
  }

  function moveSelection(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !results.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(
        (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[selectedIndex]);
    }
  }

  function moveFocusedResult(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    setActiveIndex(next);
    resultRefs.current[next]?.focus({ preventScroll: true });
  }

  let resultIndex = 0;
  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={scopeId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
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
          onClose();
      }}
    >
      <div className={styles.heading}>
        <div className={styles.headingText}>
          <span className={styles.searchMark}>
            <Search size={20} />
          </span>
          <h2 id={titleId}>{t('Find your next move', 'ค้นหาสิ่งที่ต้องการ')}</h2>
        </div>
        <div className={styles.headingTools}>
          <kbd>Ctrl K</kbd>
          <button
            className={styles.closeButton}
            type="button"
            aria-label={t('Close search', 'ปิดการค้นหา')}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
      </div>
      <div className={styles.searchBox}>
        <Search size={23} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label={t(
            'Search customers, posts, companies, and pages',
            'ค้นหาลูกค้า โพสต์ บริษัท และหน้า',
          )}
          aria-controls={listId}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={scopeId}
          autoComplete="off"
          spellCheck={false}
          value={query}
          placeholder={t('Search customers, posts, companies…', 'ค้นหาลูกค้า โพสต์ บริษัท…')}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={moveSelection}
        />
        {query && (
          <button
            type="button"
            className={styles.clearButton}
            aria-label={t('Clear search', 'ล้างคำค้นหา')}
            onClick={() => {
              setQuery('');
              setActiveIndex(0);
              inputRef.current?.focus();
            }}
          >
            <X size={18} />
          </button>
        )}
      </div>
      <div className={styles.scope}>
        <span id={scopeId}>{t('Search across all companies', 'ค้นหาในทุกบริษัท')}</span>
        <span aria-live="polite" aria-atomic="true">
          {normalized
            ? t(
                `${number(results.length)} ${results.length === 1 ? 'result' : 'results'} shown`,
                `แสดง ${number(results.length)} ผลลัพธ์`,
              )
            : t('Your workspace, one shortcut away', 'เข้าถึงพื้นที่ทำงานได้ในพริบตา')}
        </span>
      </div>
      <div
        id={listId}
        className={styles.results}
        role="listbox"
        aria-label={t('Search results', 'ผลการค้นหา')}
      >
        {sections.map((section) => (
          <div
            key={section.key}
            role="group"
            aria-labelledby={`${id}-section-${section.key}`}
            className={styles.section}
          >
            <div id={`${id}-section-${section.key}`} className={styles.sectionLabel}>
              {section.label}
              <span>{number(section.results.length)}</span>
            </div>
            {section.results.map((result) => {
              const index = resultIndex++;
              const Icon = result.icon;
              return (
                <button
                  key={result.key}
                  ref={(element) => {
                    resultRefs.current[index] = element;
                  }}
                  id={`${id}-option-${index}`}
                  className={`${styles.result} ${index === selectedIndex ? styles.activeResult : ''} ${result.key === 'create-post' ? styles.createResult : ''}`}
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  onFocus={() => setActiveIndex(index)}
                  onKeyDown={(event) => moveFocusedResult(event, index)}
                  onClick={() => choose(result)}
                >
                  <span
                    className={styles.resultIcon}
                    style={
                      result.color
                        ? { background: `color-mix(in srgb, ${result.color} 24%, var(--surface))` }
                        : undefined
                    }
                  >
                    <Icon size={20} />
                  </span>
                  <span className={styles.resultCopy}>
                    <strong>{result.label}</strong>
                    <span>{result.detail}</span>
                  </span>
                  <span className={styles.resultMeta}>
                    {result.date && <span className={styles.date}>{result.date}</span>}
                    <ArrowUpRight size={17} className={styles.resultArrow} aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {!results.length && (
        <div className={styles.empty}>
          <span>
            <Search size={29} />
          </span>
          <h3>{t('No matches just yet', 'ยังไม่พบผลลัพธ์')}</h3>
          <p>
            {t(
              'Try a customer, company, product, or domain.',
              'ลองค้นหาลูกค้า บริษัท สินค้า หรือโดเมน',
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setActiveIndex(0);
              inputRef.current?.focus();
            }}
          >
            {t('Clear search', 'ล้างคำค้นหา')}
          </button>
        </div>
      )}
      <footer className={styles.footer}>
        <div className={styles.shortcuts}>
          <span>
            <kbd>
              <ArrowUp size={13} />
              <ArrowDown size={13} />
            </kbd>
            {t('Navigate', 'เลื่อนเลือก')}
          </span>
          <span>
            <kbd>
              <CornerDownLeft size={15} />
            </kbd>
            {t('Open', 'เปิด')}
          </span>
          <span>
            <kbd>Esc</kbd>
            {t('Close', 'ปิด')}
          </span>
        </div>
        <span className={styles.footerNote}>
          {t('Items in Trash are excluded', 'ไม่รวมรายการในถังขยะ')}
        </span>
      </footer>
    </dialog>
  );
}
