'use client';

import {
  Activity,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import {
  ArrowDownToLine,
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Code2,
  Clock3,
  Eye,
  FileText,
  Globe2,
  LayoutDashboard,
  ListFilter,
  LockKeyhole,
  Menu,
  MessageCircle,
  Package,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Building2 as CompanyIcon,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  UserRound,
  X,
} from 'lucide-react';
import type { Group, Locale, Post, Translate, View, Workspace } from '@/lib/types';
import type { ConsoleScript } from '@/lib/console-scripts';
import { isWorkspaceView, viewFromPath, workspacePath } from '@/lib/workspace-routes';
import { createEmptyWorkspace, latestViewers } from '@/lib/data';
import { buildPostSearchIndex, createPostSearchMatcher } from '@/lib/post-search';
import { sortCatalog } from '@/lib/catalog';
import { productCompanyIdMap } from '@/lib/product-company';
import { exportPostsCsv, previewPostsCsv } from '@/lib/csv';
import { providedSamplePosts, providedSamplePostsCsv } from '@/lib/provided-sample-posts';
import { addProvidedLatestReadings } from '@/lib/provided-latest-readings';
import { ensureProvidedProducts } from '@/lib/provided-products';
import { ensureProvidedPostLinks } from '@/lib/provided-post-links';
import { ensureProvidedViewerUpdates } from '@/lib/provided-viewers-update';
import { ensureProvidedMissingPosts } from '@/lib/provided-missing-posts';
import { ensureProvidedMetaUnmatchedPosts } from '@/lib/provided-meta-unmatched-posts';
import { ensureProvidedMetaRemaining } from '@/lib/provided-meta-remaining';
import { ensureProvidedMetaUpdate } from '@/lib/provided-meta-update';
import { ensureProvidedSoftwareGroups } from '@/lib/provided-software-groups';
import { ensureProvidedConsoleScripts } from '@/lib/provided-console-scripts';
import { applyGroupHtmlImport, previewGroupHtmlImport } from '@/lib/group-html-import';
import {
  applyMetaViewersUpdate,
  previewMetaViewersUpdate,
  type MetaUpdateOptions,
} from '@/lib/meta-viewers-import';
import { ensureVetraCompanyName } from '@/lib/company-name-update';
import {
  filterPostsByProduct,
  matchesPostStatusFilter,
  postPublicationStatus,
  publicPostUrl,
  sortPosts,
  type PostSort,
  type PostStatusFilter,
} from '@/lib/post-tools';
import {
  readPostListReturnState,
  withPostListReturnState,
  type PostListReturnState,
} from '@/lib/post-list-navigation';
import {
  bangkokToday,
  millisecondsUntilTomorrow,
  POST_CLICKS_KEY,
  readDailyPostClicks,
  resetDailyPostClicks,
  recordPostClick,
  sameDailyPostClicks,
  type DailyPostClicks,
} from '@/lib/post-clicks';
import { PostConflictError } from '@/lib/post-save';
import { selectNextPostLink } from '@/lib/next-post-link';
import { openPostLinkInNewTab } from '@/lib/open-post-link';
import { readPostCompanySelection, writePostCompanySelection } from '@/lib/post-company-selection';
import { preparePostSaveWithGroup, PostGroupSaveError } from '@/lib/post-save-with-group';
import { browserSourceNeedsReview, connectWorkspace } from '@/lib/http-workspace-repository';
import {
  readOnlyWorkspaceRepository,
  type CachedWorkspace,
} from '@/lib/remote-workspace-repository';
import { bangkokCalendarNow, formatCalendarDate } from '@/lib/calendar';
import { setRemoteCarrierLabels } from '@/lib/order-labels';
import WorkspaceStartup from './WorkspaceStartup';
import {
  LocalWorkspaceRepository,
  WorkspaceIdentityConflict,
  WorkspaceRemovedError,
  WorkspaceRevisionConflict,
  WorkspaceStorageError,
  WorkspaceUnreadableError,
  type WorkspaceRepository,
  type WorkspaceSnapshot,
} from '@/lib/workspace-repository';
import PostEditorControl, { type PostEditorControlHandle } from './PostEditorControl';
import QuickSearchControl, { type QuickSearchControlHandle } from './QuickSearchControl';
import ImportControl from './ImportControl';
import MetaUpdateControl from './MetaUpdateControl';
import GroupHtmlImportControl from './GroupHtmlImportControl';
import ToastControl, { type ToastControlHandle } from './ToastControl';
import { GroupsPanel, SettingsPanel, TrashPanel } from './WorkspacePanels';
import CatalogPanel from './CatalogPanel';
import CustomersPanel from './CustomersPanel';
import ScriptsPanel from './ScriptsPanel';
import ScriptEditor from './ScriptEditor';
import ScriptCodeEditor from './ScriptCodeEditor';
import OrdersPanel from './OrdersPanel';
import PostSortDialog, { postSortOptions } from './PostSortDialog';
import PostPlatformDialog, { postPlatformOptions } from './PostPlatformDialog';
import PostStatusDialog, { postStatusOptions } from './PostStatusDialog';
import { SelectionControl } from './SelectionDialog';
import TableColumnHeading from './TableColumnHeading';
import PostTableBody from './PostTableBody';
import s from './MarketingApp.module.css';
import list from './WorkspaceList.module.css';

const navItems: { id: View; en: string; th: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', en: 'Overview', th: 'ภาพรวม', icon: LayoutDashboard },
  { id: 'posts', en: 'Post library', th: 'คลังโพสต์', icon: ClipboardList },
  { id: 'scripts', en: 'Code scripts', th: 'คลังสคริปต์', icon: Code2 },
  { id: 'groups', en: 'Facebook groups', th: 'กลุ่ม Facebook', icon: Users },
  { id: 'analytics', en: 'Performance', th: 'ผลลัพธ์', icon: BarChart3 },
  { id: 'products', en: 'Products', th: 'สินค้า', icon: Package },
  { id: 'customers', en: 'Customers', th: 'ลูกค้า', icon: UserRound },
  { id: 'orders', en: 'Orders', th: 'ออเดอร์', icon: ShoppingBag },
  { id: 'companies', en: 'Companies', th: 'บริษัท', icon: CompanyIcon },
  { id: 'settings', en: 'Workspace settings', th: 'ตั้งค่าพื้นที่ทำงาน', icon: Settings2 },
  { id: 'trash', en: 'Trash', th: 'ถังขยะ', icon: Trash2 },
];
function download(text: string, name: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const dateKey = (value: Date | string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
function BackToTop({ t }: { t: Translate }) {
  const button = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setVisible(window.scrollY > 320 || document.activeElement === button.current);
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  function goToTop() {
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }

  return (
    <button
      ref={button}
      type="button"
      className={`${s.backToTop} ${visible ? s.backToTopVisible : ''}`}
      aria-label={t('Go to top', 'กลับขึ้นด้านบน')}
      aria-hidden={visible ? undefined : true}
      tabIndex={visible ? 0 : -1}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(window.scrollY > 320)}
      onClick={goToTop}
    >
      <ChevronUp size={23} strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}
function displayCompanyName(name: string) {
  return name === 'VETRA Store' ? 'VETRA STORE' : name;
}

function PostTableHead({
  t,
  sorting,
}: {
  t: Translate;
  sorting?: { value: PostSort; onSelect: (value: PostSort) => void };
}) {
  function headerSort(
    first: PostSort,
    reverse: PostSort,
    firstDirection: 'ascending' | 'descending',
  ) {
    if (!sorting) return undefined;
    const reverseDirection = firstDirection === 'ascending' ? 'descending' : 'ascending';
    const next = sorting.value === first ? reverse : first;
    const label = postSortOptions.find((option) => option.value === next)!;
    return {
      direction:
        sorting.value === first
          ? firstDirection
          : sorting.value === reverse
            ? reverseDirection
            : undefined,
      nextLabel: t(`Sort by ${label.en}`, `เรียงตาม${label.th}`),
      onClick: () => sorting.onSelect(next),
    };
  }
  return (
    <thead>
      <tr>
        <TableColumnHeading
          label={t('Product / company', 'สินค้า / บริษัท')}
          icon={Package}
          secondaryIcon={CompanyIcon}
          sort={headerSort('title', 'title-desc', 'ascending')}
          secondarySort={headerSort('company', 'company-desc', 'ascending')}
        />
        <TableColumnHeading
          label={t('Destination', 'ปลายทาง')}
          icon={Globe2}
          sort={headerSort('group', 'group-desc', 'ascending')}
        />
        <TableColumnHeading
          label={t('Viewers', 'ผู้ชม')}
          icon={Eye}
          sort={headerSort('viewers', 'viewers-asc', 'descending')}
        />
        <TableColumnHeading
          label={t('Viewers per day', 'ผู้ชมต่อวัน')}
          icon={Eye}
          secondaryIcon={Clock3}
          sort={headerSort('viewers-per-day', 'viewers-per-day-asc', 'descending')}
          description={t(
            'Approximate average: current Viewers total divided by days since publication (minimum one day)',
            'ค่าเฉลี่ยโดยประมาณ: ยอดผู้ชมล่าสุดหารด้วยจำนวนวันตั้งแต่เผยแพร่ (อย่างน้อยหนึ่งวัน)',
          )}
        />
        <TableColumnHeading
          label={t('Comments', 'ความคิดเห็น')}
          icon={MessageCircle}
          sort={headerSort('comments', 'comments-asc', 'descending')}
        />
        <TableColumnHeading
          label={t('Published on', 'วันที่เผยแพร่')}
          icon={CalendarDays}
          sort={headerSort('recent', 'date-asc', 'descending')}
        />
      </tr>
    </thead>
  );
}

function PostListSkeleton({ t }: { t: Translate }) {
  return (
    <div className={s.postListSkeleton}>
      <div className={s.skeletonStatus} role="status">
        <span className={s.skeletonStatusDot} aria-hidden="true" />
        {t('Loading posts…', 'กำลังโหลดโพสต์…')}
      </div>
      <div className={s.tableScroll} aria-busy="true">
        <table className={`${s.table} ${s.skeletonTable}`} aria-hidden="true">
          <PostTableHead t={t} />
          <tbody>
            {Array.from({ length: 5 }, (_, index) => (
              <tr key={index}>
                <td>
                  <div className={s.skeletonProduct}>
                    <span className={`${s.skeletonBlock} ${s.skeletonPin}`} />
                    <span className={`${s.skeletonBlock} ${s.skeletonThumbnail}`} />
                    <span className={s.skeletonProductText}>
                      <span className={`${s.skeletonBlock} ${s.skeletonTitle}`} />
                      <span className={`${s.skeletonBlock} ${s.skeletonMeta}`} />
                    </span>
                  </div>
                </td>
                <td>
                  <div className={s.skeletonDestination}>
                    <span className={`${s.skeletonBlock} ${s.skeletonPlatform}`} />
                    <span className={`${s.skeletonBlock} ${s.skeletonDestinationText}`} />
                  </div>
                </td>
                <td data-label={t('Viewers', 'ผู้ชม')}>
                  <span className={`${s.skeletonBlock} ${s.skeletonNumber}`} />
                </td>
                <td data-label={t('Viewer/day', 'ผู้ชม/วัน')}>
                  <span className={`${s.skeletonBlock} ${s.skeletonNumber}`} />
                </td>
                <td data-label={t('Comments', 'ความคิดเห็น')}>
                  <span className={`${s.skeletonBlock} ${s.skeletonNumber}`} />
                </td>
                <td data-label={t('Published', 'เผยแพร่เมื่อ')}>
                  <span className={`${s.skeletonBlock} ${s.skeletonDate}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorkspaceEditorView({
  visible,
  managesVisibility = false,
  children,
}: {
  visible: boolean;
  managesVisibility?: boolean;
  children: (onEditorOpenChange: (open: boolean) => void) => React.ReactNode;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  if (!visible && !editorOpen) return null;
  if (managesVisibility) return children(setEditorOpen);
  return <Activity mode={visible ? 'visible' : 'hidden'}>{children(setEditorOpen)}</Activity>;
}

export default function MarketingApp({
  initialView = 'overview',
  onLock,
}: {
  initialView?: View;
  onLock: () => void;
}) {
  const [data, setData] = useState<Workspace | null>(null),
    [revision, setRevision] = useState(''),
    [locale, setLocale] = useState<Locale>('th'),
    [view, setView] = useState<View>(initialView),
    [companyId, setCompanyId] = useState('all'),
    [productId, setProductId] = useState('all'),
    [search, setSearch] = useState(''),
    [platform, setPlatform] = useState('all'),
    [statusFilter, setStatusFilter] = useState<PostStatusFilter>('normal'),
    [sampleImporting, setSampleImporting] = useState(false),
    [latestReadingsImporting, setLatestReadingsImporting] = useState(false),
    [storageError, setStorageError] = useState(''),
    [mongo, setMongo] = useState(false),
    [cachedView, setCachedView] = useState<CachedWorkspace | null>(null),
    [offlineOffer, setOfflineOffer] = useState<CachedWorkspace | null>(null),
    [browserCopyDiffers, setBrowserCopyDiffers] = useState(false),
    [startup, setStartup] = useState<{
      error?: string;
      openCache?: () => void;
      initialize?: (workspace: Workspace) => Promise<unknown>;
    } | null>(null),
    [sort, setSort] = useState<PostSort>('viewers'),
    [pinSavingId, setPinSavingId] = useState<string | null>(null),
    [postClicks, setPostClicks] = useState<DailyPostClicks>({ day: '', counts: {} }),
    [clickTrackingError, setClickTrackingError] = useState(false);
  const [customerToOpen, setCustomerToOpen] = useState<string | null>(null);
  const readOnly = cachedView !== null;
  // Keep an open draft alive when browser history changes the page behind its dialog.
  const [scriptEditing, setScriptEditing] = useState<{
    initial: ConsoleScript;
    isNew: boolean;
  } | null>(null);
  const [scriptCodeEditing, setScriptCodeEditing] = useState<ConsoleScript | null>(null);
  const navDialog = useRef<HTMLDialogElement>(null),
    menuButton = useRef<HTMLButtonElement>(null),
    // Toggling the drawer must not re-render the entire post table.
    navOpen = useRef(false),
    editorControl = useRef<PostEditorControlHandle>(null),
    quickSearchControl = useRef<QuickSearchControlHandle>(null),
    toastControl = useRef<ToastControlHandle>(null),
    pendingToast = useRef(''),
    repository = useRef<WorkspaceRepository | null>(null),
    stopLiveUpdates = useRef<(() => void) | undefined>(undefined),
    readingCache = useRef(false),
    navCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    previousBodyOverflow = useRef('');
  const sampleImportBusy = useRef(false);
  const pinSaveBusy = useRef(false);
  const pinScrollPosition = useRef<{ left: number; top: number } | null>(null);
  const postListViewport = useRef<HTMLDivElement>(null);
  const postListHeight = useRef(0);
  const [postListRestore, setPostListRestore] = useState<PostListReturnState | null>(null);
  const productCompaniesById = useMemo(
    () => productCompanyIdMap(data?.products ?? [], data?.posts ?? []),
    [data?.products, data?.posts],
  );
  const companyOptions = useMemo(
    () => [
      ...(view === 'posts' ? [{ value: 'all', en: 'All', th: 'ทั้งหมด' }] : []),
      ...sortCatalog(data?.companies ?? []).map((company) => ({
        value: company.id,
        en: displayCompanyName(company.name),
        th: displayCompanyName(company.name),
      })),
    ],
    [data?.companies, view],
  );
  const productOptions = useMemo(
    () => [
      { value: 'all', en: 'All products', th: 'ทุกสินค้า' },
      ...sortCatalog(
        (data?.products ?? []).filter(
          (product) =>
            !product.deletedAt &&
            (companyId === 'all' || productCompaniesById.get(product.id)?.includes(companyId)),
        ),
      ).map((product) => ({ value: product.id, en: product.name, th: product.name })),
    ],
    [data?.products, companyId, productCompaniesById],
  );
  const t: Translate = useCallback((en, th) => (locale === 'th' ? th : en), [locale]);
  const notify = useCallback((message: string) => {
    if (toastControl.current) toastControl.current.show(message);
    else pendingToast.current = message;
  }, []);
  function rememberedPostCompany() {
    try {
      return readPostCompanySelection(window.localStorage);
    } catch {
      return 'all';
    }
  }
  function rememberPostCompany(id: string) {
    if (readOnly) return;
    try {
      if (writePostCompanySelection(window.localStorage, id)) return;
    } catch {
      // The browser can block access to localStorage itself.
    }
    notify(
      t(
        'Could not remember this company selection in this browser.',
        'ไม่สามารถจดจำบริษัทที่เลือกในเบราว์เซอร์นี้ได้',
      ),
    );
  }
  useEffect(() => {
    if (!data || !pendingToast.current || !toastControl.current) return;
    toastControl.current.show(pendingToast.current);
    pendingToast.current = '';
  }, [data]);
  function openNavigation() {
    const dialog = navDialog.current;
    if (!dialog) return;
    if (navCloseTimer.current) {
      clearTimeout(navCloseTimer.current);
      navCloseTimer.current = null;
    }
    if (!dialog.open) {
      previousBodyOverflow.current = document.body.style.overflow;
      dialog.showModal();
      document.body.style.overflow = 'hidden';
    }
    dialog.classList.remove(s.navClosing);
    dialog.querySelector<HTMLElement>(`.${s.closeNav}`)?.focus({ preventScroll: true });
    navOpen.current = true;
    menuButton.current?.setAttribute('aria-expanded', 'true');
  }
  function closeNavigation() {
    const dialog = navDialog.current;
    if (!dialog?.open || navCloseTimer.current) return;
    dialog.classList.add(s.navClosing);
    navOpen.current = false;
    menuButton.current?.setAttribute('aria-expanded', 'false');
    const finish = () => {
      dialog.close();
      dialog.classList.remove(s.navClosing);
      document.body.style.overflow = previousBodyOverflow.current;
      menuButton.current?.focus({ preventScroll: true });
      navCloseTimer.current = null;
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
    else navCloseTimer.current = setTimeout(finish, 150);
  }
  const applySnapshot = useCallback((snapshot: WorkspaceSnapshot) => {
    if (readingCache.current) return;
    setOfflineOffer(null);
    setData(snapshot.workspace);
    setRevision(snapshot.revision);
    setStorageError('');
  }, []);
  const noteRepositoryFailure = useCallback((error: unknown) => {
    if (
      error instanceof WorkspaceUnreadableError ||
      error instanceof WorkspaceRemovedError ||
      error instanceof WorkspaceStorageError
    )
      setStorageError(
        'Saved data could not be read or written. It has been preserved. Export or restore a backup in Settings before continuing. / ไม่สามารถอ่านหรือบันทึกข้อมูลเดิมได้ ข้อมูลเดิมยังคงอยู่',
      );
  }, []);
  async function applyMetaUpdates(
    source: string,
    previewRevision: string,
    options: MetaUpdateOptions,
  ) {
    const store = repository.current;
    if (!store || storageError)
      throw new Error(
        t(
          'Restore a backup in Settings before updating posts.',
          'กรุณากู้คืนไฟล์สำรองในการตั้งค่าก่อนอัปเดตโพสต์',
        ),
      );
    let latest: WorkspaceSnapshot;
    try {
      latest = await store.load();
    } catch (error) {
      noteRepositoryFailure(error);
      throw error;
    }
    if (latest.revision !== previewRevision) {
      applySnapshot(latest);
      throw new Error(
        t(
          'The workspace changed. Review a fresh preview before applying updates.',
          'พื้นที่ทำงานเปลี่ยนไป กรุณาตรวจสอบตัวอย่างล่าสุดก่อนอัปเดต',
        ),
      );
    }
    const freshPreview = previewMetaViewersUpdate(source, latest.workspace, options);
    if (!freshPreview.changes.length)
      throw new Error(
        t('No safe changes are ready to apply.', 'ไม่มีข้อมูลที่อัปเดตได้อย่างปลอดภัย'),
      );
    try {
      applySnapshot(
        await store.commit({
          workspace: applyMetaViewersUpdate(latest.workspace, freshPreview),
          expectedRevision: latest.revision,
          operationId: crypto.randomUUID(),
        }),
      );
    } catch (error) {
      noteRepositoryFailure(error);
      if (error instanceof WorkspaceRevisionConflict) {
        applySnapshot(await store.load());
        throw new Error(
          t(
            'The workspace changed while saving. Review a fresh preview and try again.',
            'พื้นที่ทำงานเปลี่ยนระหว่างบันทึก กรุณาตรวจสอบตัวอย่างล่าสุดแล้วลองใหม่',
          ),
        );
      }
      throw error;
    }
    notify(
      t(
        `Updated ${freshPreview.changes.length} ${freshPreview.changes.length === 1 ? 'post' : 'posts'}${freshPreview.issues.length ? `; ${freshPreview.issues.length} ${freshPreview.issues.length === 1 ? 'row needs' : 'rows need'} review` : ''}.`,
        `อัปเดต ${freshPreview.changes.length} โพสต์${freshPreview.issues.length ? `; มี ${freshPreview.issues.length} แถวที่ต้องตรวจสอบ` : ''}`,
      ),
    );
  }
  async function applyGroupImport(source: string, destination: string, previewRevision: string) {
    const store = repository.current;
    if (!store || storageError)
      throw new Error(
        t(
          'Restore a backup in Settings before importing groups.',
          'กรุณากู้คืนไฟล์สำรองในการตั้งค่าก่อนนำเข้ากลุ่ม',
        ),
      );
    let latest: WorkspaceSnapshot;
    try {
      latest = await store.load();
    } catch (error) {
      noteRepositoryFailure(error);
      throw error;
    }
    if (latest.revision !== previewRevision) {
      applySnapshot(latest);
      throw new Error(
        t(
          'The workspace changed. Preview the groups again before saving.',
          'พื้นที่ทำงานเปลี่ยนไป กรุณาดูตัวอย่างกลุ่มอีกครั้งก่อนบันทึก',
        ),
      );
    }
    const freshPreview = previewGroupHtmlImport(source, latest.workspace, destination);
    if (!freshPreview.changes.length)
      throw new Error(
        t('No group changes are ready to apply.', 'ไม่มีการเปลี่ยนแปลงกลุ่มที่พร้อมบันทึก'),
      );
    try {
      applySnapshot(
        await store.commit({
          workspace: applyGroupHtmlImport(latest.workspace, freshPreview),
          expectedRevision: latest.revision,
          operationId: crypto.randomUUID(),
        }),
      );
    } catch (error) {
      noteRepositoryFailure(error);
      if (error instanceof WorkspaceRevisionConflict) {
        applySnapshot(await store.load());
        throw new Error(
          t(
            'The workspace changed while saving. Preview the groups again and try once more.',
            'พื้นที่ทำงานเปลี่ยนระหว่างบันทึก กรุณาดูตัวอย่างกลุ่มอีกครั้งแล้วลองใหม่',
          ),
        );
      }
      throw error;
    }
    const added = freshPreview.changes.filter((change) => change.kind === 'add').length;
    const updated = freshPreview.changes.length - added;
    notify(
      t(
        `Added ${added} groups and updated ${updated} groups.`,
        `เพิ่ม ${added} กลุ่ม และอัปเดต ${updated} กลุ่มแล้ว`,
      ),
    );
  }
  async function applyCsvImport(source: string, destination: string, previewRevision: string) {
    const store = repository.current;
    if (!store || storageError)
      throw new Error(
        t(
          'Restore a backup in Settings before importing.',
          'กรุณากู้คืนไฟล์สำรองในการตั้งค่าก่อนนำเข้า',
        ),
      );
    let latest: WorkspaceSnapshot;
    try {
      latest = await store.load();
    } catch (error) {
      noteRepositoryFailure(error);
      throw error;
    }
    if (latest.revision !== previewRevision) {
      applySnapshot(latest);
      throw new Error(
        t(
          'The workspace changed. Review the updated import preview, then try again.',
          'พื้นที่ทำงานมีการเปลี่ยนแปลง กรุณาตรวจสอบตัวอย่างนำเข้าที่อัปเดตแล้วลองอีกครั้ง',
        ),
      );
    }
    const freshPreview = previewPostsCsv(source, latest.workspace, destination);
    if (!freshPreview.posts.length)
      throw new Error(t('No posts are ready to import.', 'ไม่มีโพสต์ที่พร้อมนำเข้า'));
    try {
      applySnapshot(
        await store.commit({
          workspace: {
            ...latest.workspace,
            posts: [...freshPreview.posts, ...latest.workspace.posts],
            groups: [...latest.workspace.groups, ...freshPreview.groups],
          },
          expectedRevision: latest.revision,
          operationId: crypto.randomUUID(),
        }),
      );
    } catch (error) {
      noteRepositoryFailure(error);
      if (error instanceof WorkspaceRevisionConflict) {
        applySnapshot(await store.load());
        throw new Error(
          t(
            'The workspace changed while importing. Review the updated preview, then try again.',
            'พื้นที่ทำงานเปลี่ยนแปลงระหว่างนำเข้า กรุณาตรวจสอบตัวอย่างที่อัปเดตแล้วลองอีกครั้ง',
          ),
        );
      }
      throw error;
    }
    notify(
      t(
        `${freshPreview.posts.length} posts imported.`,
        `นำเข้า ${freshPreview.posts.length} โพสต์แล้ว`,
      ),
    );
  }
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    try {
      setLocale(new LocalWorkspaceRepository().readLocale());
    } catch {
      setLocale('th');
    }
    void connectWorkspace(
      () =>
        notify(
          t(
            'MongoDB saved the workspace. The browser recovery copy could not be updated.',
            'บันทึกพื้นที่ทำงานใน MongoDB แล้ว แต่ไม่สามารถอัปเดตสำเนาในเบราว์เซอร์',
          ),
        ),
      (cached) => {
        if (active && !readingCache.current) setOfflineOffer(cached);
      },
    )
      .then(({ store, mode, initialize, migrationSourceDigest, cached }) => {
        if (!active) return;
        repository.current = store;
        setMongo(mode === 'mongo');
        setRemoteCarrierLabels(mode === 'mongo');
        if (mode === 'cached') {
          setStartup({ openCache: () => openCached(cached) });
          return;
        }
        if (initialize) {
          setStartup({ initialize });
          return;
        }
        void browserSourceNeedsReview(migrationSourceDigest)
          .then((differs) => {
            if (active) setBrowserCopyDiffers(differs);
          })
          .catch(() => {
            /* The stored copy remains available for explicit recovery. */
          });
        void store.load().then(
          async (snapshot) => {
            if (!active) return;
            try {
              const named = await ensureVetraCompanyName(store, snapshot);
              const catalog = await ensureProvidedProducts(store, named);
              const posts = await ensureProvidedPostLinks(store, catalog);
              const viewers = await ensureProvidedViewerUpdates(store, posts);
              const updated = await ensureProvidedMissingPosts(store, viewers);
              const recent = await ensureProvidedMetaUpdate(store, updated);
              const unmatched = await ensureProvidedMetaUnmatchedPosts(store, recent);
              const remaining = await ensureProvidedMetaRemaining(store, unmatched);
              const softwareGroups = await ensureProvidedSoftwareGroups(store, remaining);
              const consoleScripts = await ensureProvidedConsoleScripts(store, softwareGroups);
              if (active) applySnapshot(consoleScripts);
            } catch {
              const latest = await store.load().catch(() => snapshot);
              if (!active) return;
              applySnapshot(latest);
              notify(
                t(
                  'Workspace updates could not be saved. Your existing data is available; reload to retry.',
                  'บันทึกการอัปเดตพื้นที่ทำงานไม่สำเร็จ ข้อมูลเดิมยังใช้งานได้ โหลดหน้าใหม่เพื่อลองอีกครั้ง',
                ),
              );
            }
          },
          (error: unknown) => {
            if (!active) return;
            if (mode === 'mongo') {
              setStartup({ error: error instanceof Error ? error.message : String(error) });
              return;
            }
            setStorageError(
              'Saved data could not be loaded. It has been preserved. Export or restore a backup in Settings before continuing. / ไม่สามารถโหลดข้อมูลที่บันทึกไว้ได้ ข้อมูลเดิมยังคงอยู่',
            );
            setData(createEmptyWorkspace());
          },
        );
        unsubscribe = store.subscribe((result) => {
          if (!active || readingCache.current) return;
          if (result instanceof Error) {
            setStorageError(
              'Updated workspace could not be read. / ไม่สามารถอ่านข้อมูลที่อัปเดตได้',
            );
          } else {
            applySnapshot(result);
          }
        });
        stopLiveUpdates.current = unsubscribe;
      })
      .catch((error: unknown) => {
        if (active) setStartup({ error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      active = false;
      unsubscribe?.();
      repository.current = null;
    };
  }, []);
  function openCached(cached: CachedWorkspace) {
    setScriptEditing(null);
    setScriptCodeEditing(null);
    setCustomerToOpen(null);
    stopLiveUpdates.current?.();
    readingCache.current = true;
    repository.current = readOnlyWorkspaceRepository(cached);
    setMongo(true);
    setRemoteCarrierLabels(false);
    setCachedView(cached);
    setStartup(null);
    setOfflineOffer(null);
    setBrowserCopyDiffers(false);
    setData(cached.workspace);
    setRevision(cached.revision);
    setStorageError('');
  }
  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      const day = bangkokToday();
      try {
        const next = readDailyPostClicks(window.localStorage, day);
        setPostClicks((previous) => (sameDailyPostClicks(previous, next) ? previous : next));
        setClickTrackingError(false);
      } catch {
        const next = { day, counts: {} };
        setPostClicks((previous) => (sameDailyPostClicks(previous, next) ? previous : next));
        setClickTrackingError(true);
      }
    };
    const scheduleMidnight = () => {
      clearTimeout(midnightTimer);
      midnightTimer = setTimeout(() => {
        refresh();
        scheduleMidnight();
      }, millisecondsUntilTomorrow() + 20);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === POST_CLICKS_KEY || event.key === null) refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
        scheduleMidnight();
      }
    };
    refresh();
    scheduleMidnight();
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onVisibility);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(midnightTimer);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onVisibility);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  useEffect(() => {
    if (view === 'posts' && companyId === 'all') return;
    if (data && !data.companies.some((store) => store.id === companyId)) {
      setCompanyId(view === 'posts' ? 'all' : (sortCatalog(data.companies)[0]?.id ?? 'all'));
    }
  }, [data, companyId, view]);
  useEffect(() => {
    if (
      data &&
      productId !== 'all' &&
      !data.products.some(
        (product) =>
          product.id === productId &&
          !product.deletedAt &&
          (companyId === 'all' || productCompaniesById.get(product.id)?.includes(companyId)),
      )
    ) {
      setProductId('all');
    }
  }, [data, productId, companyId, productCompaniesById]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    function handleSearchShortcut(event: KeyboardEvent) {
      if (event.repeat || event.isComposing) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        if (quickSearchControl.current?.isOpen()) {
          event.preventDefault();
          quickSearchControl.current.toggle();
          return;
        }
        if (
          editorControl.current?.currentPost() !== undefined ||
          document.querySelector('dialog[open]')
        )
          return;
        event.preventDefault();
        quickSearchControl.current?.open();
      }
    }
    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, []);
  useEffect(() => {
    const syncView = (restoreCompanyScope: boolean) => {
      const legacyHash = window.location.hash.slice(1);
      const legacyView =
        legacyHash === 'stores' ? 'companies' : isWorkspaceView(legacyHash) ? legacyHash : null;
      if (legacyView) {
        window.history.replaceState(
          window.history.state,
          '',
          `${workspacePath(legacyView)}${window.location.search}`,
        );
      }
      const next = legacyView ?? viewFromPath(window.location.pathname) ?? 'overview';
      setView(next);
      const preferredCompany = restoreCompanyScope ? undefined : rememberedPostCompany();
      const saved =
        next === 'posts'
          ? readPostListReturnState(window.history.state, {
              companyId: preferredCompany,
            })
          : null;
      setPostListRestore(saved);
      if (saved) {
        window.history.scrollRestoration = 'manual';
        setCompanyId(saved.companyId);
        setProductId(saved.productId);
        setSearch(saved.search);
        setPlatform(saved.platform);
        setStatusFilter(saved.statusFilter);
        setSort(saved.sort);
      } else if (next === 'posts') {
        setCompanyId(preferredCompany ?? rememberedPostCompany());
        setProductId('all');
      }
    };
    // Fresh visits use the last company choice; Back/Forward restores that history entry.
    const openView = () => syncView(false);
    const restoreView = () => syncView(true);
    openView();
    window.addEventListener('hashchange', openView);
    window.addEventListener('popstate', restoreView);
    return () => {
      window.removeEventListener('hashchange', openView);
      window.removeEventListener('popstate', restoreView);
    };
  }, []);
  useEffect(() => {
    // Also cover browser reloads and navigation from the address bar, without an unload handler.
    const onPageHide = () => rememberPostList();
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [view, companyId, productId, search, platform, statusFilter, sort]);
  useEffect(
    () => () => {
      if (navCloseTimer.current) clearTimeout(navCloseTimer.current);
      if (navDialog.current?.open) {
        navDialog.current.close();
        document.body.style.overflow = previousBodyOverflow.current;
      }
    },
    [],
  );
  useLayoutEffect(() => {
    // Keep ARIA correct if an unrelated workspace update renders while the drawer is open.
    menuButton.current?.setAttribute('aria-expanded', String(navOpen.current));
  });
  const update = useCallback(
    async (next: Workspace, allowRecovery = false): Promise<boolean> => {
      if (readOnly) return false;
      if (storageError && !allowRecovery) {
        notify(
          t(
            'Restore a backup in Settings before changing this workspace.',
            'กรุณากู้คืนไฟล์สำรองในการตั้งค่าก่อนแก้ไขข้อมูล',
          ),
        );
        return false;
      }
      try {
        const store = repository.current;
        if (!store) throw new Error('Workspace storage is not ready.');
        const saved =
          storageError && allowRecovery && !mongo
            ? await store.recover(next)
            : await store.commit({
                workspace: next,
                expectedRevision: revision,
                operationId: crypto.randomUUID(),
                ...(allowRecovery && { verifyLabelBytes: true }),
              });
        applySnapshot(saved);
        return true;
      } catch (error) {
        noteRepositoryFailure(error);
        if (error instanceof WorkspaceIdentityConflict) {
          notify(
            t(
              'This post already has an active record. Only one copy can be active at a time.',
              'โพสต์นี้มีรายการที่ใช้งานอยู่แล้ว จึงเปิดใช้งานได้เพียงรายการเดียว',
            ),
          );
          return false;
        }
        if (error instanceof WorkspaceRevisionConflict) {
          try {
            const latest = await repository.current?.load();
            if (latest) applySnapshot(latest);
          } catch {
            setStorageError(
              'Updated workspace could not be read. / ไม่สามารถอ่านข้อมูลที่อัปเดตได้',
            );
          }
          notify(
            t(
              'This workspace changed in another tab. Review the latest data, then try again.',
              'พื้นที่ทำงานถูกแก้ไขในแท็บอื่น กรุณาตรวจสอบข้อมูลล่าสุดแล้วลองอีกครั้ง',
            ),
          );
          return false;
        }
        notify(
          error instanceof Error
            ? error.message
            : t(
                'Could not save changes. Your previous data is intact.',
                'ไม่สามารถบันทึกได้ ข้อมูลเดิมยังคงอยู่',
              ),
        );
        return false;
      }
    },
    [storageError, revision, t, notify, applySnapshot, noteRepositoryFailure, mongo, readOnly],
  );
  const togglePostPin = useCallback(
    async (post: Post) => {
      if (pinSaveBusy.current || storageError || !repository.current || !data || !revision) return;
      pinSaveBusy.current = true;
      setPinSavingId(post.id);
      try {
        const store = repository.current;
        const current = data.posts.find((item) => item.id === post.id);
        if (!current || current.deletedAt || Boolean(current.pinned) !== Boolean(post.pinned)) {
          notify(
            t(
              'This post changed. Review the latest version and try again.',
              'โพสต์นี้มีการเปลี่ยนแปลง กรุณาตรวจสอบข้อมูลล่าสุดแล้วลองอีกครั้ง',
            ),
          );
          return;
        }
        const next = {
          ...data,
          posts: data.posts.map((item) =>
            item.id === post.id ? { ...item, pinned: !Boolean(current.pinned) } : item,
          ),
        };
        const saved = await store.commit({
          workspace: next,
          expectedRevision: revision,
          operationId: crypto.randomUUID(),
        });
        pinScrollPosition.current = { left: window.scrollX, top: window.scrollY };
        applySnapshot(saved);
        notify(
          current.pinned
            ? t('Post unpinned.', 'เลิกปักหมุดโพสต์แล้ว')
            : t('Post pinned to the top.', 'ปักหมุดโพสต์ไว้ด้านบนแล้ว'),
        );
      } catch (error) {
        noteRepositoryFailure(error);
        if (error instanceof WorkspaceRevisionConflict) {
          try {
            const latest = await repository.current?.load();
            if (latest) applySnapshot(latest);
          } catch {
            setStorageError(
              'Updated workspace could not be read. / ไม่สามารถอ่านข้อมูลที่อัปเดตได้',
            );
          }
          notify(
            t(
              'This workspace changed while pinning. Review the latest posts and try again.',
              'พื้นที่ทำงานเปลี่ยนไประหว่างปักหมุด กรุณาตรวจสอบโพสต์ล่าสุดแล้วลองอีกครั้ง',
            ),
          );
        } else {
          notify(
            error instanceof Error
              ? error.message
              : t(
                  'Could not save the pin. Your previous data is intact.',
                  'บันทึกหมุดไม่สำเร็จ ข้อมูลเดิมยังคงอยู่',
                ),
          );
        }
      } finally {
        pinSaveBusy.current = false;
        setPinSavingId(null);
      }
    },
    [data, revision, storageError, t, notify, applySnapshot, noteRepositoryFailure],
  );
  function changeLocale(value: Locale) {
    setLocale(value);
    if (readOnly) return;
    try {
      if (!repository.current) throw new Error('Workspace storage is not ready.');
      repository.current.writeLocale(value);
    } catch {
      notify(t('Language could not be saved.', 'ไม่สามารถบันทึกภาษาได้'));
    }
  }
  async function importProvidedSamples() {
    if (sampleImportBusy.current) return;
    sampleImportBusy.current = true;
    setSampleImporting(true);
    try {
      if (storageError || !repository.current)
        throw new Error(
          t('Restore your workspace before importing.', 'กรุณากู้คืนพื้นที่ทำงานก่อนนำเข้า'),
        );
      const latest = await repository.current.load();
      const existingPostIds = new Set(latest.workspace.posts.map((post) => post.facebookPostId));
      if (providedSamplePosts.every((sample) => existingPostIds.has(sample.postId))) {
        applySnapshot(latest);
        notify(t('All sample posts are already here.', 'มีโพสต์ตัวอย่างทั้งหมดแล้ว'));
        return;
      }
      const destination =
        companyId === 'all' ? sortCatalog(latest.workspace.companies)[0]?.id : companyId;
      const preview = previewPostsCsv(
        providedSamplePostsCsv(existingPostIds),
        latest.workspace,
        destination,
      );
      if (preview.errors.length) throw new Error(preview.errors[0]);
      if (!preview.posts.length) {
        applySnapshot(latest);
        notify(t('All sample posts are already here.', 'มีโพสต์ตัวอย่างทั้งหมดแล้ว'));
        return;
      }
      const withReadings = addProvidedLatestReadings({
        ...latest.workspace,
        posts: [...preview.posts, ...latest.workspace.posts],
        groups: [...latest.workspace.groups, ...preview.groups],
      });
      const saved = await repository.current.commit({
        workspace: withReadings.workspace,
        expectedRevision: latest.revision,
        operationId: crypto.randomUUID(),
      });
      applySnapshot(saved);
      navigate('posts', destination);
      clearLibraryFilters();
      notify(
        t(
          `${preview.posts.length} sample posts added.`,
          `เพิ่มโพสต์ตัวอย่าง ${preview.posts.length} รายการแล้ว`,
        ),
      );
    } catch (error) {
      noteRepositoryFailure(error);
      if (error instanceof WorkspaceRevisionConflict) {
        try {
          const latest = await repository.current?.load();
          if (latest) applySnapshot(latest);
        } catch {
          setStorageError('Updated workspace could not be read. / ไม่สามารถอ่านข้อมูลที่อัปเดตได้');
        }
        notify(
          t(
            'Workspace changed. Review the latest posts and try again.',
            'พื้นที่ทำงานเปลี่ยนไป กรุณาตรวจสอบโพสต์ล่าสุดแล้วลองใหม่',
          ),
        );
      } else {
        notify(
          error instanceof Error
            ? error.message
            : t('Could not add sample posts.', 'ไม่สามารถเพิ่มโพสต์ตัวอย่างได้'),
        );
      }
    } finally {
      sampleImportBusy.current = false;
      setSampleImporting(false);
    }
  }
  async function importProvidedLatestReadings() {
    if (sampleImportBusy.current) return;
    sampleImportBusy.current = true;
    setLatestReadingsImporting(true);
    try {
      if (storageError || !repository.current)
        throw new Error(
          t(
            'Restore your workspace before updating Viewers.',
            'กรุณากู้คืนพื้นที่ทำงานก่อนอัปเดตยอดผู้ชม',
          ),
        );
      const latest = await repository.current.load();
      const result = addProvidedLatestReadings(latest.workspace);
      if (!result.added) {
        applySnapshot(latest);
        notify(
          result.conflicts
            ? t(
                'Some posts have a different current total. Those totals were left unchanged.',
                'บางโพสต์มียอดผู้ชมล่าสุดต่างกัน ระบบจึงคงยอดเดิมไว้',
              )
            : t('Latest totals are already saved.', 'บันทึกยอดผู้ชมล่าสุดแล้ว'),
        );
        return;
      }
      const saved = await repository.current.commit({
        workspace: result.workspace,
        expectedRevision: latest.revision,
        operationId: crypto.randomUUID(),
      });
      applySnapshot(saved);
      notify(
        result.conflicts
          ? t(
              `${result.added} Viewers totals updated; ${result.conflicts} different totals kept unchanged.`,
              `อัปเดตยอดผู้ชม ${result.added} รายการ และคงยอดเดิม ${result.conflicts} รายการ`,
            )
          : t(
              `${result.added} Viewers totals updated.`,
              `อัปเดตยอดผู้ชม ${result.added} รายการแล้ว`,
            ),
      );
    } catch (error) {
      noteRepositoryFailure(error);
      if (error instanceof WorkspaceRevisionConflict) {
        try {
          const latest = await repository.current?.load();
          if (latest) applySnapshot(latest);
        } catch {
          setStorageError('Updated workspace could not be read. / ไม่สามารถอ่านข้อมูลที่อัปเดตได้');
        }
        notify(
          t(
            'Workspace changed. Review the latest posts and try again.',
            'พื้นที่ทำงานเปลี่ยนไป กรุณาตรวจสอบโพสต์ล่าสุดแล้วลองใหม่',
          ),
        );
      } else {
        notify(
          error instanceof Error
            ? error.message
            : t('Could not update Viewers totals.', 'ไม่สามารถอัปเดตยอดผู้ชมได้'),
        );
      }
    } finally {
      sampleImportBusy.current = false;
      setLatestReadingsImporting(false);
    }
  }
  // Defer only filter controls. A saved pin changes workspace data, and should
  // reorder the existing rows directly instead of flashing a loading skeleton.
  const listControls = useMemo(
    () => ({ search, platform, statusFilter, sort, locale, companyId, productId }),
    [search, platform, statusFilter, sort, locale, companyId, productId],
  );
  const deferredListControls = useDeferredValue(listControls);
  const postListPending = listControls !== deferredListControls;
  const scopedCompanyId = view === 'posts' ? deferredListControls.companyId : companyId;
  const scopedProductId = view === 'posts' ? deferredListControls.productId : productId;
  const companyScoped = useMemo(
    () =>
      data?.posts.filter(
        (p) => !p.deletedAt && (scopedCompanyId === 'all' || p.companyId === scopedCompanyId),
      ) ?? [],
    [data?.posts, scopedCompanyId],
  );
  const scoped = useMemo(
    () =>
      filterPostsByProduct(companyScoped, data?.products ?? [], scopedProductId, data?.posts ?? []),
    [companyScoped, data?.products, data?.posts, scopedProductId],
  );
  const groupsById = useMemo(
    () => new Map((data?.groups ?? []).map((item) => [item.id, item])),
    [data?.groups],
  );
  const missingSampleCount = useMemo(() => {
    const postIds = new Set(data?.posts.map((post) => post.facebookPostId));
    return providedSamplePosts.filter((sample) => !postIds.has(sample.postId)).length;
  }, [data?.posts]);
  const pendingLatestReadings = useMemo(
    () => (data ? addProvidedLatestReadings(data).added : 0),
    [data],
  );
  const published = useMemo(
    () => scoped.filter((post) => postPublicationStatus(post) === 'published'),
    [scoped],
  );
  const groups = useMemo(
    () =>
      data?.groups.filter(
        (g) => !g.deletedAt && (companyId === 'all' || g.companyId === companyId),
      ) ?? [],
    [data?.groups, companyId],
  );
  const total = useMemo(() => published.reduce((n, p) => n + latestViewers(p), 0), [published]);
  const overviewPosts = useMemo(
    () => (view === 'overview' ? sortPosts(published, 'recent', locale).slice(0, 5) : []),
    [view, published, locale],
  );
  const performancePosts = useMemo(
    () => (view === 'analytics' ? sortPosts(published, 'viewers', locale, data ?? undefined) : []),
    [view, published, locale, data],
  );
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(locale === 'th' ? 'th-TH' : 'en-US', { maximumFractionDigits: 0 }),
    [locale],
  );
  const compactFormatter = useMemo(
    () => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }),
    [],
  );
  const fmt = (n: number) => numberFormatter.format(n);
  const short = (n: number) => compactFormatter.format(n);
  const chosenCompany = data?.companies.find((st) => st.id === companyId);
  function navigate(next: View, postCompanyId?: string) {
    closeNavigation();
    rememberPostList();
    setPostListRestore(null);
    if (window.location.pathname !== workspacePath(next) || window.location.hash)
      window.history.pushState(null, '', workspacePath(next));
    window.scrollTo({ top: 0, behavior: 'instant' });
    setView(next);
    if (next === 'posts') {
      setCompanyId(postCompanyId ?? rememberedPostCompany());
      setProductId('all');
    }
    setSearch('');
    setPlatform('all');
    setStatusFilter('normal');
  }
  function newPost() {
    editorControl.current?.open(null);
  }
  async function savePost(post: Post, pendingGroup: Group | null): Promise<void> {
    const store = repository.current;
    if (!data || !store || storageError)
      throw new Error(
        t(
          'Restore a backup in Settings before changing this workspace.',
          'กรุณากู้คืนไฟล์สำรองในการตั้งค่าก่อนแก้ไขข้อมูล',
        ),
      );
    let latest: WorkspaceSnapshot;
    try {
      latest = await store.load();
    } catch (error) {
      noteRepositoryFailure(error);
      throw new Error(
        t(
          'Your saved workspace could not be read. Your edits remain here. Download a backup before reloading.',
          'ไม่สามารถอ่านพื้นที่ทำงานที่บันทึกไว้ได้ การแก้ไขยังอยู่ที่นี่ กรุณาดาวน์โหลดไฟล์สำรองก่อนโหลดหน้าใหม่',
        ),
      );
    }
    let next: Workspace;
    try {
      next = preparePostSaveWithGroup(
        latest.workspace,
        post,
        editorControl.current?.currentPost() ?? null,
        pendingGroup,
      );
    } catch (error) {
      if (error instanceof PostGroupSaveError) {
        applySnapshot(latest);
        if (error.reason === 'group-in-trash')
          throw new Error(
            t(
              'This Facebook group is in Trash. Restore it before saving this post.',
              'กลุ่ม Facebook นี้อยู่ในถังขยะ กรุณากู้คืนก่อนบันทึกโพสต์',
            ),
          );
        if (error.reason === 'group-id-collision')
          throw new Error(
            t(
              'The new group could not be saved. Close and reopen the form, then try again.',
              'บันทึกกลุ่มใหม่ไม่สำเร็จ กรุณาปิดและเปิดแบบฟอร์มอีกครั้ง แล้วลองใหม่',
            ),
          );
        throw new Error(
          t(
            'The group extracted from the link is no longer valid. Paste the link again.',
            'ข้อมูลกลุ่มที่อ่านจากลิงก์ไม่ถูกต้องแล้ว กรุณาวางลิงก์อีกครั้ง',
          ),
        );
      }
      if (!(error instanceof PostConflictError)) throw error;
      applySnapshot(latest);
      if (error.reason === 'existing-post')
        throw new Error(
          t(
            'This post already has an active record. Open that record to edit it.',
            'โพสต์นี้มีรายการที่ใช้งานอยู่แล้ว กรุณาเปิดรายการนั้นเพื่อแก้ไข',
          ),
        );
      throw new Error(
        t(
          'This post changed in another tab or is no longer available. Your edits remain here. Copy anything you want to keep, then close and reopen the latest version.',
          'โพสต์นี้ถูกแก้ไขในแท็บอื่นหรือไม่พร้อมใช้งานแล้ว การแก้ไขของคุณยังอยู่ที่นี่ คัดลอกสิ่งที่ต้องการเก็บไว้ แล้วปิดและเปิดโพสต์เวอร์ชันล่าสุดอีกครั้ง',
        ),
      );
    }
    try {
      applySnapshot(
        await store.commit({
          workspace: next,
          expectedRevision: latest.revision,
          operationId: crypto.randomUUID(),
        }),
      );
    } catch (error) {
      noteRepositoryFailure(error);
      if (error instanceof WorkspaceIdentityConflict)
        throw new Error(
          t(
            'This post already has an active record. Open that record to edit it.',
            'โพสต์นี้มีรายการที่ใช้งานอยู่แล้ว กรุณาเปิดรายการนั้นเพื่อแก้ไข',
          ),
        );
      if (error instanceof WorkspaceRevisionConflict) {
        try {
          applySnapshot(await store.load());
        } catch {
          setStorageError('Updated workspace could not be read. / ไม่สามารถอ่านข้อมูลที่อัปเดตได้');
        }
        throw new Error(
          t(
            'This workspace changed while saving. Your edits remain here; review the latest post and try again.',
            'พื้นที่ทำงานถูกแก้ไขระหว่างบันทึก การแก้ไขของคุณยังอยู่ที่นี่ กรุณาตรวจสอบโพสต์ล่าสุดแล้วลองอีกครั้ง',
          ),
        );
      }
      throw new Error(
        error instanceof Error
          ? error.message
          : t(
              'Could not save this post. Your changes remain here; try again.',
              'บันทึกโพสต์ไม่สำเร็จ การแก้ไขของคุณยังอยู่ที่นี่ กรุณาลองอีกครั้ง',
            ),
      );
    }
    editorControl.current?.close();
    notify(t('Post saved to your workspace.', 'บันทึกโพสต์แล้ว'));
  }
  async function trashPost(post: Post): Promise<boolean> {
    if (!data || !data.posts.some((item) => item.id === post.id && !item.deletedAt)) return false;
    const deletedAt = new Date().toISOString();
    const saved = await update({
      ...data,
      posts: data.posts.map((item) => (item.id === post.id ? { ...item, deletedAt } : item)),
    });
    if (!saved) return false;
    notify(
      t(
        'Moved to Trash. You can restore it for 30 days.',
        'ย้ายไปถังขยะแล้ว กู้คืนได้ภายใน 30 วัน',
      ),
    );
    return true;
  }
  function exportCsv(posts?: Post[]) {
    if (data) {
      download(
        exportPostsCsv(
          posts ? { ...data, posts } : data,
          companyId === 'all' ? undefined : companyId,
        ),
        `vetra-posts-${dateKey(new Date())}.csv`,
      );
      notify(t('Your CSV export is ready.', 'ส่งออก CSV แล้ว'));
    }
  }
  const postSearchInput = useRef<HTMLInputElement>(null);
  const postSearchIndex = useMemo(
    () => (data && view === 'posts' ? buildPostSearchIndex(data) : new Map<string, string>()),
    [data?.posts, data?.companies, data?.products, data?.groups, data?.destinations, view],
  );
  const filtered = useMemo(() => {
    if (view !== 'posts') return [];
    const { search, platform, statusFilter, sort, locale } = deferredListControls;
    const matchesSearch = createPostSearchMatcher(postSearchIndex, search);
    return sortPosts(
      scoped.filter(
        (post) =>
          matchesPostStatusFilter(
            post,
            Boolean(publicPostUrl(post, groupsById.get(post.groupId)?.facebookId ?? '')),
            statusFilter,
          ) &&
          (platform === 'all' || post.platform === platform) &&
          matchesSearch(post),
      ),
      sort,
      locale,
      data ?? undefined,
    );
  }, [data, scoped, deferredListControls, groupsById, postSearchIndex, view]);
  const nextPostLink = useMemo(
    () => selectNextPostLink(filtered, data?.groups ?? [], postClicks),
    [filtered, data?.groups, postClicks],
  );
  const zeroClickPostCount = useMemo(() => {
    const counts = postClicks.day === bangkokToday() ? postClicks.counts : null;
    return filtered.reduce((total, post) => total + ((counts?.[post.id] ?? 0) === 0 ? 1 : 0), 0);
  }, [filtered, postClicks]);
  useLayoutEffect(() => {
    const position = pinScrollPosition.current;
    if (!position) return;
    pinScrollPosition.current = null;
    window.scrollTo({ ...position, behavior: 'instant' });
  }, [data]);
  useLayoutEffect(() => {
    if (view === 'posts' && !postListPending && postListViewport.current)
      postListHeight.current = postListViewport.current.offsetHeight;
  }, [view, postListPending, filtered]);
  useLayoutEffect(() => {
    const saved = postListRestore;
    if (!data || view !== 'posts' || !saved || postListPending) return;
    if (companyId !== 'all' && !data.companies.some((store) => store.id === companyId)) return;
    if (
      productId !== 'all' &&
      !data.products.some((product) => product.id === productId && !product.deletedAt)
    )
      return;
    // Restore only after the final filtered rows replace the loading skeleton.
    setPostListRestore(null);
    if (postListViewport.current) postListViewport.current.scrollLeft = saved.tableScrollLeft;
    window.scrollTo({ left: saved.scrollX, top: saved.scrollY, behavior: 'instant' });
  }, [data, view, companyId, productId, postListRestore, postListPending]);
  const hasLibraryFilters =
    !!search.trim() || platform !== 'all' || productId !== 'all' || statusFilter !== 'normal';
  const canLoadSuppliedPosts =
    view === 'posts' &&
    !hasLibraryFilters &&
    data?.posts.length === 0 &&
    missingSampleCount === providedSamplePosts.length;
  function clearLibraryFilters() {
    setSearch('');
    setPlatform('all');
    setProductId('all');
    setStatusFilter('normal');
  }
  function clearVisiblePostFilters() {
    clearLibraryFilters();
    setCompanyId('all');
    if (view === 'posts') rememberPostCompany('all');
  }

  function navContent() {
    return (
      <>
        <div className={s.workspaceLabel}>{t('YOUR WORKSPACE', 'พื้นที่ทำงานของคุณ')}</div>
        <nav aria-label={t('Main navigation', 'เมนูหลัก')}>
          {navItems
            .filter((item) => !['settings', 'trash'].includes(item.id))
            .map((item) => (
              <button
                key={item.id}
                className={`${s.navItem} ${view === item.id ? s.navActive : ''}`}
                onClick={() => navigate(item.id)}
                aria-current={view === item.id ? 'page' : undefined}
              >
                <item.icon size={19} />
                <span>{t(item.en, item.th)}</span>
                {item.id === 'posts' && <b>{scoped.length}</b>}
                {view === item.id && <i />}
              </button>
            ))}
        </nav>
        <div className={s.navDivider} />
        <div className={s.workspaceLabel}>{t('MANAGE', 'จัดการ')}</div>
        <nav aria-label={t('Workspace management', 'จัดการพื้นที่ทำงาน')}>
          {navItems
            .filter((item) => ['settings', 'trash'].includes(item.id))
            .map((item) => (
              <button
                key={item.id}
                className={`${s.navItem} ${view === item.id ? s.navActive : ''}`}
                onClick={() => navigate(item.id)}
                aria-current={view === item.id ? 'page' : undefined}
              >
                <item.icon size={19} />
                <span>{t(item.en, item.th)}</span>
              </button>
            ))}
        </nav>
        <div className={s.sidebarBottom}>
          <div className={s.sidebarNote}>
            <span className={s.tinySpark}>✦</span>
            <strong>{t('A space for every company.', 'พื้นที่ของทุกบริษัท')}</strong>
            <p>
              {t(
                'Keep companies, customers, and published posts connected.',
                'เชื่อมบริษัท ลูกค้า และโพสต์ที่เผยแพร่แล้วไว้ด้วยกัน',
              )}
            </p>
            <button onClick={() => navigate('companies')}>
              {t('Manage your companies', 'จัดการบริษัท')}
              <ArrowUpRight size={17} />
            </button>
          </div>
          <div className={s.profile}>
            <span className={s.avatar}>V</span>
            <div>
              <strong>{t('My workspace', 'พื้นที่ทำงานของฉัน')}</strong>
              <span>
                <i />
                {mongo ? 'MongoDB' : t('Saved in this browser', 'บันทึกในเบราว์เซอร์นี้')}
              </span>
            </div>
          </div>
        </div>
      </>
    );
  }

  function rememberPostList() {
    if (view !== 'posts') return;
    try {
      window.history.replaceState(
        withPostListReturnState(window.history.state, {
          companyId,
          productId,
          search,
          platform,
          statusFilter,
          sort,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          tableScrollLeft: postListViewport.current?.scrollLeft ?? 0,
        }),
        '',
      );
      window.history.scrollRestoration = 'manual';
    } catch {
      // Browser history restrictions must not stop the user from opening a post.
    }
  }

  function resetClickCounts() {
    if (readOnly) return;
    try {
      setPostClicks(resetDailyPostClicks(window.localStorage));
      setClickTrackingError(false);
      notify(
        t(
          'Today’s click counts reset for all posts in this browser.',
          'รีเซ็ตจำนวนคลิกวันนี้ของทุกโพสต์ในเบราว์เซอร์นี้แล้ว',
        ),
      );
    } catch {
      notify(
        t(
          'Could not reset click counts. Your saved counts have not changed.',
          'รีเซ็ตจำนวนคลิกไม่สำเร็จ จำนวนคลิกที่บันทึกไว้ยังคงเดิม',
        ),
      );
    }
  }

  const trackPostOpen = useCallback(
    (postId: string, now = new Date()) => {
      if (readOnly) return;
      try {
        setPostClicks(recordPostClick(window.localStorage, postId, now));
        setClickTrackingError(false);
      } catch {
        setClickTrackingError(true);
        notify(
          t(
            'The post opened, but today’s click could not be saved in this browser.',
            'เปิดโพสต์แล้ว แต่บันทึกจำนวนคลิกวันนี้ในเบราว์เซอร์ไม่สำเร็จ',
          ),
        );
      }
    },
    [t, notify, readOnly],
  );
  function openNextPost() {
    if (!data || postListPending) return;
    const now = new Date();
    let currentClicks: DailyPostClicks;
    try {
      // Read immediately before choosing so rapid clicks and other tabs use the latest counts.
      currentClicks = readDailyPostClicks(window.localStorage, bangkokToday(now));
    } catch {
      setClickTrackingError(true);
      notify(
        t(
          'Could not read today’s click counts. Open a post from the list, or reset the click counts.',
          'อ่านจำนวนคลิกวันนี้ไม่สำเร็จ กรุณาเปิดโพสต์จากรายการหรือรีเซ็ตจำนวนคลิก',
        ),
      );
      return;
    }
    const next = selectNextPostLink(filtered, data.groups, currentClicks, now);
    if (!next) return;
    rememberPostList();
    if (!openPostLinkInNewTab(next.url)) {
      notify(
        t(
          'The post could not open. Allow this site to open a new tab, then try again.',
          'เปิดโพสต์ไม่สำเร็จ กรุณาอนุญาตให้เว็บไซต์นี้เปิดแท็บใหม่แล้วลองอีกครั้ง',
        ),
      );
      return;
    }
    trackPostOpen(next.post.id, now);
  }
  const editPost = useCallback((post: Post) => editorControl.current?.open(post), []);

  function postTable(posts: Post[]) {
    const onlyHiddenStatuses =
      view === 'posts' &&
      statusFilter === 'normal' &&
      !search.trim() &&
      platform === 'all' &&
      scoped.length > 0 &&
      posts.length === 0;
    const emptyBecauseFiltered =
      onlyHiddenStatuses || (view === 'posts' && (hasLibraryFilters || companyId !== 'all'));
    return posts.length ? (
      <div className={s.tableScroll} ref={view === 'posts' ? postListViewport : undefined}>
        <table className={s.table}>
          <PostTableHead
            t={t}
            sorting={view === 'posts' ? { value: sort, onSelect: setSort } : undefined}
          />
          <PostTableBody
            posts={posts}
            data={data!}
            locale={locale}
            t={t}
            view={view}
            postClicks={postClicks}
            clickTrackingError={clickTrackingError}
            pinSavingId={pinSavingId}
            storageError={Boolean(storageError) || readOnly}
            readOnly={readOnly}
            togglePostPin={togglePostPin}
            trackPostOpen={trackPostOpen}
            onEdit={editPost}
          />
        </table>
      </div>
    ) : (
      <div className={s.empty}>
        <FileText size={30} />
        <h3>
          {onlyHiddenStatuses
            ? t('No normal posts yet', 'ยังไม่มีโพสต์ปกติ')
            : emptyBecauseFiltered || productId !== 'all'
              ? t('No matching posts', 'ไม่พบโพสต์ที่ตรงกัน')
              : canLoadSuppliedPosts
                ? t('Your 26 supplied posts are ready', 'โพสต์ที่คุณให้มา 26 รายการพร้อมเพิ่ม')
                : t('Track your first post', 'ติดตามโพสต์รายการแรก')}
        </h3>
        <p>
          {onlyHiddenStatuses
            ? t(
                'Your posts are in Pending or No link. Choose another status to see them.',
                'โพสต์ของคุณอยู่ในสถานะรอดำเนินการหรือไม่มีลิงก์ เลือกสถานะอื่นเพื่อดู',
              )
            : emptyBecauseFiltered || productId !== 'all'
              ? t('Try another keyword or clear your filters.', 'ลองคำค้นอื่นหรือล้างตัวกรอง')
              : canLoadSuppliedPosts
                ? t(
                    'This workspace has no posts yet. Add the supplied posts with their latest Viewers totals.',
                    'พื้นที่ทำงานนี้ยังไม่มีโพสต์ เพิ่มโพสต์ที่คุณให้มาพร้อมยอดผู้ชมล่าสุด',
                  )
                : t(
                    'Add a link to a post that is already live, or import existing records.',
                    'เพิ่มลิงก์โพสต์ที่เผยแพร่แล้ว หรือนำเข้ารายการเดิม',
                  )}
        </p>
        <button
          className={s.primary}
          disabled={
            (!emptyBecauseFiltered && !onlyHiddenStatuses && productId === 'all' && readOnly) ||
            (canLoadSuppliedPosts && (sampleImporting || Boolean(storageError)))
          }
          onClick={() =>
            onlyHiddenStatuses
              ? setStatusFilter('all')
              : emptyBecauseFiltered || productId !== 'all'
                ? clearVisiblePostFilters()
                : canLoadSuppliedPosts
                  ? void importProvidedSamples()
                  : newPost()
          }
        >
          {onlyHiddenStatuses
            ? t('Show all posts', 'แสดงโพสต์ทั้งหมด')
            : emptyBecauseFiltered || productId !== 'all'
              ? t('Clear filters', 'ล้างตัวกรอง')
              : canLoadSuppliedPosts
                ? sampleImporting
                  ? t('Adding…', 'กำลังเพิ่ม…')
                  : t('Add 26 supplied posts', 'เพิ่มโพสต์ที่ให้มา 26 รายการ')
                : t('Add post', 'เพิ่มโพสต์')}
        </button>
      </div>
    );
  }

  function stats() {
    return (
      <div className={s.stats}>
        <Stat
          title={t('Published posts', 'โพสต์ที่เผยแพร่')}
          value={fmt(published.length)}
          note={t(
            `${published.filter((p) => p.viewers !== null).length} with Viewers totals`,
            `${published.filter((p) => p.viewers !== null).length} โพสต์ที่มียอดผู้ชม`,
          )}
          icon={<FileText size={19} />}
          color="blue"
        />
        <Stat
          title={t('Post viewers', 'ผู้ชมของแต่ละโพสต์')}
          value={published.some((post) => post.viewers !== null) ? short(total) : '—'}
          note={t('Sum of current totals across posts', 'ผลรวมยอดล่าสุดของทุกโพสต์')}
          icon={<Users size={19} />}
          color="purple"
        />
        <Stat
          title={t('Active groups', 'กลุ่มที่ใช้งาน')}
          value={fmt(groups.length)}
          note={t(
            `${data!.companies.length} companies, one workspace`,
            `${data!.companies.length} บริษัท ในพื้นที่เดียว`,
          )}
          icon={<Globe2 size={19} />}
          color="orange"
        />
      </div>
    );
  }
  const lockLabel = t('Lock workspace', 'ล็อกพื้นที่ทำงาน');
  const lockButton = (
    <button
      type="button"
      className={s.lockWorkspace}
      aria-label={lockLabel}
      title={lockLabel}
      onClick={onLock}
    >
      <LockKeyhole size={18} aria-hidden="true" />
      <span>{lockLabel}</span>
    </button>
  );
  if (startup) return <WorkspaceStartup {...startup} t={t} lockButton={lockButton} />;
  if (!data && view === 'posts')
    return (
      <div className={s.app}>
        <header className={s.topbar}>
          <span className={s.loadingBrand}>
            <img src="/logo_white.svg" alt="VETRA" width={1211} height={202} /> Marketing
          </span>
          {lockButton}
        </header>
        <main className={s.main}>
          <div className={s.workspaceBar} aria-hidden="true">
            <span className={`${s.skeletonBlock} ${s.loadingWorkspacePill}`} />
          </div>
          <section className={s.panel}>
            <div className={s.postTools}>
              <h1>{t('Tracked posts', 'โพสต์ที่ติดตาม')} · …</h1>
              <div className={s.loadingActions} aria-hidden="true">
                <span className={`${s.skeletonBlock} ${s.loadingAction}`} />
                <span className={`${s.skeletonBlock} ${s.loadingAction}`} />
              </div>
            </div>
            <div className={s.filterBar} aria-hidden="true">
              <span className={`${s.skeletonBlock} ${s.loadingSearch}`} />
              <span className={`${s.skeletonBlock} ${s.loadingFilter}`} />
            </div>
            <PostListSkeleton t={t} />
            <div className={s.tableFooter}>{t('Loading posts…', 'กำลังโหลดโพสต์…')}</div>
          </section>
        </main>
      </div>
    );
  if (!data)
    return (
      <div className={s.loading}>
        <img src="/logo_white.svg" alt="VETRA" width={1211} height={202} />
        <strong>Marketing</strong>
        <span>{t('Opening your workspace…', 'กำลังเปิดพื้นที่ทำงาน…')}</span>
        {lockButton}
      </div>
    );
  const selectedCompanyName =
    view === 'posts' && companyId === 'all'
      ? t('All', 'ทั้งหมด')
      : displayCompanyName(
          data.companies.find((store) => store.id === companyId)?.name ||
            t('Choose a company', 'เลือกบริษัท'),
        );
  const selectedProductName =
    productId === 'all'
      ? t('All products', 'ทุกสินค้า')
      : data.products.find((product) => product.id === productId && !product.deletedAt)?.name ||
        t('All products', 'ทุกสินค้า');
  const heading: { [key in View]: [string, string, string, string] } = {
    overview: [
      'Your marketing, in focus.',
      'มองการตลาดได้ชัดขึ้น',
      'Every company. Every story. One clear picture.',
      'ทุกบริษัท ทุกเรื่องราว เห็นภาพรวมในที่เดียว',
    ],
    posts: [
      'Every published post, in one place.',
      'รวมโพสต์ที่เผยแพร่แล้วไว้ในที่เดียว',
      'Open a live post, or use Edit to update its current Viewers total.',
      'เปิดโพสต์ที่เผยแพร่แล้ว หรือกดแก้ไขเพื่ออัปเดตยอดผู้ชมล่าสุด',
    ],
    scripts: [
      'Your console scripts, organized.',
      'จัดสคริปต์คอนโซลให้เป็นระเบียบ',
      'Save and copy JavaScript for Facebook, Instagram, and TikTok.',
      'บันทึกและคัดลอก JavaScript สำหรับ Facebook, Instagram และ TikTok',
    ],
    groups: [
      'Find your people.',
      'เข้าถึงกลุ่มคนที่ใช่',
      'Keep your communities and posting notes together.',
      'รวมกลุ่มเป้าหมายและบันทึกการโพสต์ไว้ด้วยกัน',
    ],
    analytics: [
      'Your posts, at a glance.',
      'ดูผลลัพธ์ของโพสต์ได้ทันที',
      'Compare current Viewers totals across published posts.',
      'เปรียบเทียบยอดผู้ชมล่าสุดของโพสต์ที่เผยแพร่แล้ว',
    ],
    products: [
      'Your product catalog.',
      'จัดการสินค้าของคุณ',
      'Keep product names, images, and display order together.',
      'รวมชื่อสินค้า รูปภาพ และลำดับการแสดงผลไว้ด้วยกัน',
    ],
    companies: [
      'Different companies. One place.',
      'หลายบริษัท ในพื้นที่เดียว',
      'Give every company a space of its own.',
      'ให้ทุกบริษัทมีพื้นที่ของตัวเอง',
    ],
    customers: [
      'Know every customer.',
      'ดูแลข้อมูลลูกค้าทุกคน',
      'Contacts and business details, connected to the right company.',
      'รวมข้อมูลติดต่อและรายละเอียดธุรกิจให้ตรงกับแต่ละบริษัท',
    ],
    orders: [
      'From order to doorstep.',
      'จัดการออเดอร์จนถึงมือผู้รับ',
      'Track customer orders, items, and delivery details.',
      'ติดตามออเดอร์ของลูกค้า รายการสินค้า และข้อมูลจัดส่ง',
    ],
    settings: [
      'Make yourself at home.',
      'จัดพื้นที่ให้เป็นแบบคุณ',
      'Your workspace, data, and preferences.',
      'จัดการพื้นที่ทำงาน ข้อมูล และการตั้งค่า',
    ],
    trash: [
      'Room to change your mind.',
      'เปลี่ยนใจได้เสมอ',
      'Deleted items can be restored for 30 days.',
      'รายการที่ลบสามารถกู้คืนได้ภายใน 30 วัน',
    ],
  };
  return (
    <div className={s.app} key={readOnly ? 'cached' : 'live'}>
      <title>
        {t('VETRA Marketing — Your marketing, in focus', 'VETRA Marketing — พื้นที่ทำงานการตลาด')}
      </title>
      <a className="skip-link" href="#main">
        {t('Skip to content', 'ข้ามไปยังเนื้อหา')}
      </a>
      <dialog
        id="workspace-navigation"
        ref={navDialog}
        className={s.navDialog}
        aria-label={t('Navigation', 'เมนูนำทาง')}
        onCancel={(event) => {
          event.preventDefault();
          closeNavigation();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeNavigation();
        }}
      >
        <div className={s.mobileNav}>
          <button
            className={s.closeNav}
            onClick={closeNavigation}
            aria-label={t('Close navigation', 'ปิดเมนู')}
          >
            <X size={22} />
          </button>
          {navContent()}
        </div>
      </dialog>
      <div className={s.mainShell}>
        <header className={s.topbar}>
          <div className={s.topLeft}>
            <button
              ref={menuButton}
              className={`${s.iconButton} ${s.menuButton}`}
              aria-label={t('Open navigation', 'เปิดเมนู')}
              aria-controls="workspace-navigation"
              aria-expanded={false}
              onClick={openNavigation}
            >
              <Menu size={22} />
            </button>
            <Link
              className={s.headerBrand}
              href="/"
              aria-label={t('Home', 'หน้าหลัก')}
              onNavigate={(event) => {
                event.preventDefault();
                navigate('overview');
              }}
            >
              <img src="/logo_white.svg" alt="" width={1211} height={202} />
            </Link>
            <span className={s.breadcrumb}>
              {t('Workspace', 'พื้นที่ทำงาน')}
              <ChevronRight size={14} />
              <strong>
                {t(
                  navItems.find((n) => n.id === view)!.en,
                  navItems.find((n) => n.id === view)!.th,
                )}
              </strong>
            </span>
          </div>
          <div className={s.topRight}>
            <QuickSearchControl
              ref={quickSearchControl}
              data={data}
              locale={locale}
              t={t}
              className={s.topSearch}
              onNavigate={navigate}
              onOpenPost={(post) => {
                navigate('posts', post.companyId);
                if (!readOnly) editorControl.current?.open(post);
              }}
              onSelectCompany={(id) => {
                setCompanyId(id);
                setProductId('all');
                const next = view === 'customers' || view === 'companies' ? 'customers' : 'posts';
                if (next === 'posts') rememberPostCompany(id);
                navigate(next, id);
              }}
              onOpenCustomer={(customer) => {
                setCompanyId(customer.companyId);
                setCustomerToOpen(customer.id);
                navigate('customers');
              }}
              onCreatePost={readOnly ? undefined : newPost}
            />
            <div className={s.language}>
              <button
                type="button"
                className={s.languageSwitch}
                aria-label={
                  locale === 'th' ? 'ภาษาไทย · เปลี่ยนเป็นภาษาอังกฤษ' : 'English · Switch to Thai'
                }
                title={locale === 'th' ? 'เปลี่ยนเป็นภาษาอังกฤษ' : 'Switch to Thai'}
                onClick={() => changeLocale(locale === 'th' ? 'en' : 'th')}
              >
                {locale === 'th' ? 'TH' : 'EN'}
              </button>
            </div>
            {lockButton}
          </div>
        </header>
        <main id="main" className={s.main} tabIndex={-1}>
          <div className={s.workspaceBar} hidden={view === 'scripts' && !data.sample}>
            {!['companies', 'settings', 'scripts'].includes(view) && (
              <div className={s.workspaceFilters}>
                <SelectionControl
                  title={t('Select company', 'เลือกบริษัท')}
                  options={companyOptions}
                  value={companyId}
                  t={t}
                  onSelect={(id) => {
                    setCompanyId(id);
                    setProductId('all');
                    if (view === 'posts') rememberPostCompany(id);
                  }}
                  trigger={(open, openDialog) => (
                    <button
                      type="button"
                      className={s.companySelect}
                      disabled={data.companies.length === 0}
                      aria-haspopup="dialog"
                      aria-expanded={open}
                      aria-label={`${t('Select company', 'เลือกบริษัท')}: ${selectedCompanyName}`}
                      onClick={openDialog}
                    >
                      <span className={s.companySelectIcon}>
                        <CompanyIcon size={17} aria-hidden="true" />
                      </span>
                      <span className={s.companySelectName} title={selectedCompanyName}>
                        {selectedCompanyName}
                      </span>
                      <ChevronDown size={15} aria-hidden="true" />
                    </button>
                  )}
                />
                {['overview', 'posts', 'analytics'].includes(view) && (
                  <SelectionControl
                    title={t('Select product', 'เลือกสินค้า')}
                    options={productOptions}
                    value={productId}
                    t={t}
                    onSelect={setProductId}
                    trigger={(open, openDialog) => (
                      <button
                        type="button"
                        className={s.companySelect}
                        aria-haspopup="dialog"
                        aria-expanded={open}
                        aria-label={`${t('Select product', 'เลือกสินค้า')}: ${selectedProductName}`}
                        onClick={openDialog}
                      >
                        <span className={s.companySelectIcon}>
                          <Package size={17} aria-hidden="true" />
                        </span>
                        <span className={s.companySelectName} title={selectedProductName}>
                          {selectedProductName}
                        </span>
                        <ChevronDown size={15} aria-hidden="true" />
                      </button>
                    )}
                  />
                )}
              </div>
            )}
            {(data.sample || view === 'posts') && (
              <div className={`${s.workspaceMeta} ${view === 'posts' ? s.postsWorkspaceMeta : ''}`}>
                {data.sample && (
                  <span className={s.sampleTag}>
                    <span />
                    {t('Sample workspace', 'พื้นที่ทำงานตัวอย่าง')}
                  </span>
                )}
                {view === 'posts' && (
                  <div className={s.postsWorkspaceActions}>
                    <ImportControl
                      disabled={readOnly}
                      data={data}
                      revision={revision}
                      companyId={companyId}
                      t={t}
                      className={s.secondary}
                      onImport={applyCsvImport}
                    />
                    <button
                      type="button"
                      className={s.secondary}
                      onClick={() => exportCsv(filtered)}
                      disabled={postListPending || !filtered.length}
                    >
                      <ArrowDownToLine size={18} aria-hidden="true" />
                      {t('Export CSV', 'ส่งออก CSV')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          {cachedView && (
            <div role="status" className={s.errorBanner}>
              <strong>{t('Read-only workspace', 'พื้นที่ทำงานแบบอ่านอย่างเดียว')}</strong>
              <span>
                {cachedView.syncedAt
                  ? t('Last synced', 'ซิงก์ล่าสุด') +
                    ' ' +
                    formatCalendarDate(bangkokCalendarNow('date', new Date(cachedView.syncedAt))) +
                    ' ' +
                    bangkokCalendarNow('datetime-local', new Date(cachedView.syncedAt)).slice(11) +
                    ' ICT'
                  : t(
                      'Sync time unavailable for this older copy.',
                      'ไม่มีเวลาที่ซิงก์สำหรับสำเนารุ่นเก่านี้',
                    )}
              </span>
              <button onClick={() => window.location.reload()}>
                {t('Reconnect to MongoDB', 'เชื่อมต่อ MongoDB อีกครั้ง')}
              </button>
            </div>
          )}
          {!readOnly && offlineOffer && (
            <div role="status" className={s.errorBanner}>
              {t('MongoDB is unavailable.', 'ไม่สามารถเชื่อมต่อ MongoDB')}
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      t(
                        'Open the read-only copy? Any unsaved edits on this page will be discarded.',
                        'เปิดสำเนาแบบอ่านอย่างเดียวหรือไม่ การแก้ไขในหน้านี้ที่ยังไม่ได้บันทึกจะถูกยกเลิก',
                      ),
                    )
                  )
                    openCached(offlineOffer);
                }}
              >
                {t('Open last synced copy · Read only', 'เปิดสำเนาที่ซิงก์ล่าสุด · อ่านอย่างเดียว')}
              </button>
            </div>
          )}
          {storageError && (
            <div role="alert" className={s.errorBanner}>
              {storageError}
              <button
                onClick={() => {
                  try {
                    const raw = repository.current?.readPreservedRaw();
                    if (raw) download(raw, 'vetra-preserved-workspace.json', 'application/json');
                  } catch {
                    notify(
                      t('Browser storage is unavailable.', 'ไม่สามารถเข้าถึงพื้นที่จัดเก็บได้'),
                    );
                  }
                }}
              >
                {t('Download preserved data', 'ดาวน์โหลดข้อมูลเดิม')}
              </button>
              <button onClick={() => navigate('settings')}>
                {t('Open settings', 'เปิดการตั้งค่า')}
              </button>
            </div>
          )}
          {browserCopyDiffers && (
            <div className={s.errorBanner} role="status">
              {t(
                'This browser has a different copy from the original MongoDB import. Download the browser copy in Settings to review it.',
                'สำเนาในเบราว์เซอร์นี้ต่างจากข้อมูลที่นำเข้าใน MongoDB ครั้งแรก ดาวน์โหลดสำเนาในหน้าการตั้งค่าเพื่อตรวจสอบ',
              )}
              {view !== 'settings' && (
                <button onClick={() => navigate('settings')}>
                  {t('Open settings', 'เปิดการตั้งค่า')}
                </button>
              )}
            </div>
          )}
          {!['customers', 'posts', 'scripts'].includes(view) && (
            <div className={s.pageHeading}>
              <div>
                <span className={s.eyebrow}>
                  {view === 'overview'
                    ? t('A LITTLE MORE CLARITY', 'เห็นภาพชัดขึ้นอีกนิด')
                    : (!['products', 'companies', 'settings'].includes(view) &&
                        chosenCompany?.name.toUpperCase()) ||
                      t('YOUR MARKETING WORKSPACE', 'พื้นที่ทำงานการตลาดของคุณ')}
                </span>
                <h1>{t(heading[view][0], heading[view][1])}</h1>
                <p>{t(heading[view][2], heading[view][3])}</p>
              </div>
              {['overview', 'analytics'].includes(view) && (
                <div className={s.headingActions}>
                  <ImportControl
                    disabled={readOnly}
                    data={data}
                    revision={revision}
                    companyId={companyId}
                    t={t}
                    className={s.secondary}
                    onImport={applyCsvImport}
                  />
                  <button className={s.primary} disabled={readOnly} onClick={() => newPost()}>
                    <Plus size={19} />
                    {t('Add post', 'เพิ่มโพสต์')}
                  </button>
                </div>
              )}
            </div>
          )}
          {view === 'overview' && (
            <>
              {stats()}
              <section className={s.panel}>
                <div className={s.panelHead}>
                  <div>
                    <h2>{t('Pinned & recently published', 'โพสต์ที่ปักหมุดและเผยแพร่ล่าสุด')}</h2>
                    <p>
                      {t(
                        'Use Edit to update a post’s details or Viewers.',
                        'กดแก้ไขเพื่ออัปเดตข้อมูลโพสต์หรือยอดผู้ชม',
                      )}
                    </p>
                  </div>
                  <button className={s.textButton} onClick={() => navigate('posts')}>
                    {t('View all posts', 'ดูโพสต์ทั้งหมด')}
                    <ArrowRight size={16} />
                  </button>
                </div>
                {postTable(overviewPosts)}
              </section>
              <div className={s.bottomNote}>
                <ShieldCheck size={16} />
                {mongo
                  ? t('Your workspace is saved in MongoDB.', 'พื้นที่ทำงานบันทึกอยู่ใน MongoDB')
                  : t(
                      'Your workspace stays in this browser. Export a backup to keep it safe.',
                      'ข้อมูลเก็บอยู่ในเบราว์เซอร์นี้ ส่งออกไฟล์สำรองเพื่อเก็บรักษาข้อมูล',
                    )}
                <button onClick={() => navigate('settings')}>
                  {t('Manage data', 'จัดการข้อมูล')}
                  <ArrowUpRight size={14} />
                </button>
              </div>
            </>
          )}
          {view === 'posts' && (
            <section className={`${s.panel} ${list.panel}`}>
              <div className={`${s.postTools} ${list.header}`}>
                <div className={s.postToolsStart}>
                  <button
                    type="button"
                    className={`${list.action} ${s.openPostAction}`}
                    onClick={openNextPost}
                    disabled={postListPending || !nextPostLink}
                    title={
                      nextPostLink
                        ? t(
                            'Open one post in a new tab, starting with the fewest clicks today. Ties follow the current list order.',
                            'เปิดทีละโพสต์ในแท็บใหม่ เริ่มจากโพสต์ที่มีคลิกวันนี้น้อยที่สุด หากเท่ากันใช้ลำดับรายการปัจจุบัน',
                          )
                        : t('No posts with links in this list.', 'ไม่มีโพสต์ที่มีลิงก์ในรายการนี้')
                    }
                  >
                    {t('Open post', 'เปิดโพสต์')}
                  </button>
                  <h1 className={list.title}>
                    {t('Tracked posts', 'โพสต์ที่ติดตาม')} ·{' '}
                    {postListPending ? '…' : fmt(filtered.length)}
                  </h1>
                  <span className={s.zeroClickHint} role="status">
                    {clickTrackingError
                      ? t('Zero-click count unavailable', 'ไม่สามารถแสดงจำนวนโพสต์ที่ไม่มีคลิกได้')
                      : postListPending
                        ? t('Counting zero-click posts…', 'กำลังนับโพสต์ที่ไม่มีคลิก…')
                        : t(
                            `${fmt(zeroClickPostCount)} ${zeroClickPostCount === 1 ? 'post' : 'posts'} with 0 clicks today`,
                            `${fmt(zeroClickPostCount)} โพสต์ยังไม่มีคลิกวันนี้`,
                          )}
                  </span>
                </div>
                <div className={`${s.libraryActions} ${list.actions}`}>
                  <button
                    className={list.action}
                    onClick={resetClickCounts}
                    disabled={
                      readOnly ||
                      (!clickTrackingError &&
                        (postClicks.day !== bangkokToday() ||
                          !Object.values(postClicks.counts).some((count) => count > 0)))
                    }
                    title={t(
                      'Reset today’s clicks for all posts in this browser, including filtered-out posts.',
                      'รีเซ็ตจำนวนคลิกวันนี้ของทุกโพสต์ในเบราว์เซอร์นี้ รวมโพสต์ที่ตัวกรองซ่อนอยู่',
                    )}
                  >
                    <RotateCcw size={16} />
                    {t('Reset clicks', 'รีเซ็ตคลิก')}
                  </button>
                  {!readOnly && missingSampleCount > 0 && !canLoadSuppliedPosts && (
                    <button
                      className={list.action}
                      onClick={importProvidedSamples}
                      disabled={sampleImporting || latestReadingsImporting || Boolean(storageError)}
                    >
                      <Upload size={16} />
                      {sampleImporting
                        ? t('Adding…', 'กำลังเพิ่ม…')
                        : t(
                            `Add ${missingSampleCount} supplied posts`,
                            `เพิ่มโพสต์ที่ให้มา ${missingSampleCount} รายการ`,
                          )}
                    </button>
                  )}
                  {!readOnly && pendingLatestReadings > 0 && (
                    <button
                      className={list.action}
                      onClick={importProvidedLatestReadings}
                      disabled={sampleImporting || latestReadingsImporting || Boolean(storageError)}
                    >
                      <TrendingUp size={16} />
                      {latestReadingsImporting
                        ? t('Saving…', 'กำลังบันทึก…')
                        : t(
                            `Update ${pendingLatestReadings} Viewers totals`,
                            `อัปเดตยอดผู้ชม ${pendingLatestReadings} รายการ`,
                          )}
                    </button>
                  )}
                  <MetaUpdateControl
                    data={data}
                    revision={revision}
                    t={t}
                    className={list.action}
                    disabled={Boolean(storageError) || readOnly}
                    onApply={applyMetaUpdates}
                  />
                  <button
                    className={list.primaryAction}
                    disabled={readOnly}
                    onClick={() => newPost()}
                  >
                    <Plus size={16} />
                    {t('Add post', 'เพิ่มโพสต์')}
                  </button>
                </div>
              </div>
              {clickTrackingError && (
                <p className={s.clickTrackingNote} role="status">
                  {t(
                    'Today’s click counts are unavailable in this browser. Posts still open normally; saved click data has not been changed.',
                    'จำนวนคลิกวันนี้ไม่พร้อมใช้งานในเบราว์เซอร์นี้ แต่ยังเปิดโพสต์ได้ตามปกติ และข้อมูลคลิกเดิมไม่ได้ถูกเปลี่ยน',
                  )}
                </p>
              )}
              <div className={`${s.filterBar} ${list.filters}`}>
                <div className={`${s.postSearch} ${list.searchControl}`}>
                  <div className={`${s.searchField} ${list.search}`}>
                    <Search size={18} aria-hidden="true" />
                    <input
                      ref={postSearchInput}
                      type="search"
                      placeholder={t(
                        'Search names, IDs, links, dates…',
                        'ค้นหาชื่อ รหัส ลิงก์ วันที่…',
                      )}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape' && !e.nativeEvent.isComposing && search) {
                          e.preventDefault();
                          setSearch('');
                        }
                      }}
                      aria-label={t('Filter posts', 'กรองโพสต์')}
                      title={t(
                        'Search products, companies, destinations, IDs, links, dates, Meta rows, Viewers, or comments',
                        'ค้นหาสินค้า บริษัท ปลายทาง รหัส ลิงก์ วันที่ แถว Meta ยอดผู้ชม หรือความคิดเห็น',
                      )}
                      aria-describedby="post-search-help"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {search && (
                      <button
                        type="button"
                        className={`${s.clearPostSearch} ${list.clearSearch}`}
                        aria-label={t('Clear post search', 'ล้างคำค้นหาโพสต์')}
                        onClick={() => {
                          setSearch('');
                          postSearchInput.current?.focus();
                        }}
                      >
                        <X size={18} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <p id="post-search-help" className={`${s.postSearchHelp} ${list.searchHelp}`}>
                    {t(
                      'Combine words in any order. Dates: DD/MM/YYYY. Current filters still apply.',
                      'ใช้คำค้นร่วมกันได้โดยไม่ต้องเรียงลำดับ วันที่: DD/MM/YYYY โดยยังใช้ตัวกรองที่เลือกไว้',
                    )}
                  </p>
                </div>
                <div className={`${s.filterControls} ${list.filterControls}`}>
                  <PostStatusDialog
                    value={statusFilter}
                    t={t}
                    onSelect={setStatusFilter}
                    trigger={(open, openDialog) => (
                      <button
                        type="button"
                        className={`${s.statusFilter} ${list.filterButton}`}
                        data-status={statusFilter}
                        aria-haspopup="dialog"
                        aria-expanded={open}
                        aria-label={t('Filter post status', 'กรองสถานะโพสต์')}
                        onClick={openDialog}
                      >
                        <ListFilter size={16} aria-hidden="true" />
                        <span>
                          {postStatusOptions.map((option) =>
                            option.value === statusFilter ? t(option.en, option.th) : null,
                          )}
                        </span>
                        <ChevronDown size={16} aria-hidden="true" />
                      </button>
                    )}
                  />
                  <PostPlatformDialog
                    value={platform}
                    t={t}
                    onSelect={setPlatform}
                    trigger={(open, openDialog) => (
                      <button
                        type="button"
                        className={`${s.platformFilter} ${list.filterButton}`}
                        aria-haspopup="dialog"
                        aria-expanded={open}
                        aria-label={t('Filter platform', 'กรองแพลตฟอร์ม')}
                        onClick={openDialog}
                      >
                        <SlidersHorizontal size={16} aria-hidden="true" />
                        <span>
                          {postPlatformOptions.map((option) =>
                            option.value === platform ? t(option.en, option.th) : null,
                          )}
                        </span>
                        <ChevronDown size={16} aria-hidden="true" />
                      </button>
                    )}
                  />
                  <PostSortDialog
                    value={sort}
                    t={t}
                    onSelect={setSort}
                    trigger={(open, openDialog) => (
                      <button
                        type="button"
                        className={`${s.sortField} ${list.filterButton}`}
                        aria-haspopup="dialog"
                        aria-expanded={open}
                        aria-label={t('Sort posts', 'เรียงลำดับโพสต์')}
                        onClick={openDialog}
                      >
                        <ArrowDownUp size={18} aria-hidden="true" />
                        <span>
                          {postSortOptions.map((option) =>
                            option.value === sort ? t(option.en, option.th) : null,
                          )}
                        </span>
                        <ChevronDown size={16} aria-hidden="true" />
                      </button>
                    )}
                  />
                </div>
              </div>
              <div
                aria-busy={postListPending}
                style={
                  postListPending && postListHeight.current
                    ? { minHeight: postListHeight.current }
                    : undefined
                }
              >
                {postTable(filtered)}
              </div>
              <div className={`${s.tableFooter} ${list.footer}`}>
                <span role="status" aria-live="polite" aria-atomic="true">
                  {postListPending
                    ? t('Loading posts…', 'กำลังโหลดโพสต์…')
                    : t(
                        `${filtered.length} ${filtered.length === 1 ? 'post' : 'posts'} in this view`,
                        `${filtered.length} โพสต์ในมุมมองนี้`,
                      )}
                </span>
                <span>
                  {t(
                    'Daily clicks reset at midnight ICT · Saved in this browser',
                    'จำนวนคลิกรีเซ็ตเที่ยงคืนเวลาไทย · บันทึกในเบราว์เซอร์นี้',
                  )}
                </span>
              </div>
            </section>
          )}
          {view === 'analytics' && (
            <>
              {stats()}
              <section className={s.panel}>
                <div className={s.panelHead}>
                  <div>
                    <h2>{t('Stories that connect', 'โพสต์ที่เข้าถึงผู้คน')}</h2>
                    <p>
                      {t(
                        'Pinned posts first, then ranked by current Viewers total. Edit a post to replace its total.',
                        'โพสต์ที่ปักหมุดอยู่ด้านบน จากนั้นเรียงตามยอดผู้ชมล่าสุด กดแก้ไขโพสต์เพื่อเปลี่ยนยอด',
                      )}
                    </p>
                  </div>
                  <button className={s.textButton} onClick={() => exportCsv(published)}>
                    <ArrowDownToLine size={16} />
                    {t('Export', 'ส่งออก')}
                  </button>
                </div>
                {postTable(performancePosts)}
              </section>
              <div className={s.metricNote}>
                <TrendingUp size={20} />
                <p>
                  <strong>
                    {t('A clearer picture of your numbers.', 'เข้าใจตัวเลขของคุณให้ชัดขึ้น')}
                  </strong>
                  {t(
                    'Each post keeps only its current Viewers total. Totals across posts may include the same people more than once.',
                    'แต่ละโพสต์เก็บเฉพาะยอดผู้ชมล่าสุด ผลรวมหลายโพสต์อาจนับคนเดิมซ้ำกัน',
                  )}
                </p>
              </div>
            </>
          )}
          <WorkspaceEditorView visible={view === 'groups'}>
            {(onEditorOpenChange) => (
              <GroupsPanel
                onEditorOpenChange={onEditorOpenChange}
                readOnly={readOnly}
                data={data}
                companyId={companyId}
                update={update}
                t={t}
                notify={notify}
                actions={
                  <GroupHtmlImportControl
                    data={data}
                    revision={revision}
                    companyId={companyId}
                    t={t}
                    className={list.action}
                    disabled={
                      readOnly || Boolean(storageError) || !revision || !data.companies.length
                    }
                    onApply={applyGroupImport}
                  />
                }
              />
            )}
          </WorkspaceEditorView>
          <WorkspaceEditorView visible={view === 'customers'}>
            {(onEditorOpenChange) => (
              <CustomersPanel
                onEditorOpenChange={onEditorOpenChange}
                readOnly={readOnly}
                data={data}
                companyId={companyId}
                update={update}
                t={t}
                notify={notify}
                openCustomerId={customerToOpen}
                onOpenHandled={() => setCustomerToOpen(null)}
              />
            )}
          </WorkspaceEditorView>
          {view === 'scripts' && (
            <ScriptsPanel
              readOnly={readOnly}
              data={data}
              update={update}
              t={t}
              notify={notify}
              onEdit={(initial, isNew) => setScriptEditing({ initial, isNew })}
              onEditCode={setScriptCodeEditing}
            />
          )}
          <WorkspaceEditorView visible={view === 'orders'}>
            {(onEditorOpenChange) => (
              <OrdersPanel
                onEditorOpenChange={onEditorOpenChange}
                readOnly={readOnly}
                data={data}
                companyId={companyId}
                update={update}
                t={t}
                notify={notify}
              />
            )}
          </WorkspaceEditorView>
          {(['companies', 'products'] as const).map((kind) => (
            <WorkspaceEditorView key={kind} visible={view === kind} managesVisibility>
              {(onEditorOpenChange) => (
                <CatalogPanel
                  active={view === kind}
                  onEditorOpenChange={onEditorOpenChange}
                  readOnly={readOnly}
                  mediaUploadsEnabled={mongo && !readOnly}
                  kind={kind}
                  data={data}
                  companyId={companyId}
                  update={update}
                  t={t}
                  notify={notify}
                />
              )}
            </WorkspaceEditorView>
          ))}
          {view === 'settings' && (
            <SettingsPanel
              readOnly={readOnly}
              mongo={mongo}
              data={data}
              revision={revision}
              companyId={companyId}
              repository={repository.current!}
              update={async (next) => {
                const saved = await update(next, true);
                if (saved) setCompanyId('all');
                return saved;
              }}
              t={t}
              notify={notify}
            />
          )}
          {view === 'trash' && (
            <TrashPanel
              readOnly={readOnly}
              data={data}
              companyId={companyId}
              update={update}
              t={t}
              notify={notify}
            />
          )}
          <footer className={s.footer}>
            <span>
              VETRA <span>MARKETING</span>
            </span>
            <p>
              {t(
                'A little more organized. A lot more possibility.',
                'จัดการได้ดีขึ้น เปิดโอกาสได้มากขึ้น',
              )}
            </p>
          </footer>
        </main>
      </div>
      <BackToTop t={t} />
      {scriptEditing && (
        <ScriptEditor
          initial={scriptEditing.initial}
          isNew={scriptEditing.isNew}
          data={data}
          update={update}
          t={t}
          notify={notify}
          onClose={() => {
            setScriptEditing(null);
            requestAnimationFrame(() => {
              // The editor restores its opener when connected; history may have removed it.
              if (document.activeElement === document.body || !document.activeElement)
                document.getElementById('main')?.focus({ preventScroll: true });
            });
          }}
        />
      )}
      {scriptCodeEditing && (
        <ScriptCodeEditor
          initial={scriptCodeEditing}
          data={data}
          update={update}
          t={t}
          notify={notify}
          onClose={() => {
            setScriptCodeEditing(null);
            requestAnimationFrame(() => {
              if (document.activeElement === document.body || !document.activeElement)
                document.getElementById('main')?.focus({ preventScroll: true });
            });
          }}
        />
      )}
      <PostEditorControl
        ref={editorControl}
        data={data}
        companyId={companyId}
        t={t}
        onSave={savePost}
        onDelete={trashPost}
      />
      <ToastControl ref={toastControl} t={t} />
    </div>
  );
}

function Stat({
  title,
  value,
  note,
  icon,
  color,
}: {
  title: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <section className={s.stat}>
      <div className={s.statLabel}>
        {title}
        <span className={`${s.statIcon} ${s[color]}`}>{icon}</span>
      </div>
      <strong className={s.statValue}>{value}</strong>
      <p>{note}</p>
      <span className={`${s.statAccent} ${s[color]}`} />
    </section>
  );
}
