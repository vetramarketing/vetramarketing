'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  CircleHelp,
  Code2,
  ExternalLink,
  FileJson,
  FolderOpen,
  Globe2,
  Layers3,
  LockKeyhole,
  Package,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UsersRound,
  UserRound,
  X,
} from 'lucide-react';
import { createEmptyWorkspace } from '@/lib/data';
import { bangkokCalendarNow, formatCalendarDate } from '@/lib/calendar';
import { sortCatalog } from '@/lib/catalog';
import { entityEditIsCurrent } from '@/lib/entity-edit';
import { knownFacebookGroupName } from '@/lib/facebook-group-directory';
import { facebookGroupUrl } from '@/lib/facebook-group-link';
import { productCompanyIdMap } from '@/lib/product-company';
import { bangkokToday } from '@/lib/post-clicks';
import type { WorkspaceRepository } from '@/lib/workspace-repository';
import {
  exportWorkspaceWithLabels,
  prepareWorkspaceLabelRestore,
  type PreparedWorkspaceLabelRestore,
  MAX_LABEL_BACKUP_TEXT_BYTES,
} from '@/lib/order-labels';
import type { Group, Translate, Workspace } from '@/lib/types';
import styles from './WorkspacePanels.module.css';

interface PanelProps {
  data: Workspace;
  companyId: string;
  update: (next: Workspace) => Promise<boolean>;
  t: Translate;
  notify: (message: string) => void;
}
const palette = ['#4169E1', '#8B6EAD', '#38947D', '#C78843', '#BB6381', '#627D98'];
const visibleInCompany = (item: { companyId: string }, companyId: string) =>
  companyId === 'all' || item.companyId === companyId;
const newId = () => crypto.randomUUID();

function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>
        <FolderOpen size={28} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}

export function GroupsPanel({
  data,
  companyId,
  update,
  t,
  notify,
  actions,
}: PanelProps & { actions?: ReactNode }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Group | null>(null);
  const [editingBaseline, setEditingBaseline] = useState<Group | null>(null);
  const [error, setError] = useState('');
  const editorRef = useRef<HTMLFormElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const linkedPosts = editing ? data.posts.some((post) => post.groupId === editing.id) : false;
  const originalGroup = editing ? data.groups.find((group) => group.id === editing.id) : undefined;
  const facebookIdLocked = Boolean(
    originalGroup?.facebookId.trim() &&
    data.posts.some((post) => post.groupId === originalGroup.id && post.facebookPostId.trim()),
  );
  const groups = useMemo(() => {
    const term = search.toLocaleLowerCase();
    return data.groups.filter(
      (group) =>
        !group.deletedAt &&
        visibleInCompany(group, companyId) &&
        `${group.name} ${group.category} ${group.facebookId}`.toLocaleLowerCase().includes(term),
    );
  }, [data.groups, companyId, search]);
  const postCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of data.posts) {
      if (!post.deletedAt && post.groupId)
        counts.set(post.groupId, (counts.get(post.groupId) ?? 0) + 1);
    }
    return counts;
  }, [data.posts]);
  const companiesById = useMemo(
    () => new Map(data.companies.map((store) => [store.id, store])),
    [data.companies],
  );
  const begin = useCallback(
    (group?: Group) => {
      previousFocus.current = document.activeElement as HTMLElement | null;
      setEditingBaseline(group ? { ...group } : null);
      setEditing(
        group
          ? { ...group }
          : {
              id: newId(),
              companyId: companyId !== 'all' ? companyId : sortCatalog(data.companies)[0]?.id || '',
              name: '',
              facebookId: '',
              category: '',
              notes: '',
            },
      );
      setError('');
      requestAnimationFrame(() => {
        editorRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
        editorRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
      });
    },
    [data.companies, companyId],
  );
  const closeEditor = useCallback(() => {
    setEditing(null);
    requestAnimationFrame(() => {
      const target = previousFocus.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
      else addButtonRef.current?.focus({ preventScroll: true });
    });
  }, []);
  const moveToTrash = useCallback(
    async (group: Group) => {
      if (
        !(await update({
          ...data,
          groups: data.groups.map((item) =>
            item.id === group.id ? { ...item, deletedAt: new Date().toISOString() } : item,
          ),
        }))
      )
        return;
      notify(
        t(
          'Group moved to Trash. You can restore it within 30 days.',
          'ย้ายกลุ่มไปถังขยะแล้ว กู้คืนได้ภายใน 30 วัน',
        ),
      );
    },
    [data, update, notify, t],
  );
  const groupCards = useMemo(
    () =>
      groups.map((group) => {
        const store = companiesById.get(group.companyId);
        const groupUrl = facebookGroupUrl(group);
        return (
          <article className={styles.groupCard} key={group.id}>
            <div className={styles.cardTop}>
              <span className={styles.communityIcon}>
                <UsersRound size={25} />
              </span>
              <div className={styles.cardActions}>
                <button
                  className={styles.iconButton}
                  aria-label={`${t('Edit', 'แก้ไข')} ${group.name}`}
                  onClick={() => begin(group)}
                >
                  <Pencil size={17} />
                </button>
                <button
                  className={styles.iconButton}
                  aria-label={`${t('Move to Trash', 'ย้ายไปถังขยะ')} ${group.name}`}
                  onClick={() => void moveToTrash(group)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
            <span className={styles.category}>
              {group.category || t('Facebook group', 'กลุ่ม Facebook')}
            </span>
            <h3>{group.name}</h3>
            <p className={styles.groupNotes}>
              {group.notes ||
                t(
                  'Add posting notes to keep your team on the same page.',
                  'เพิ่มหมายเหตุการโพสต์เพื่อให้ทีมทำงานได้ตรงกัน',
                )}
            </p>
            <div className={styles.groupMeta}>
              <span>
                <span
                  className={styles.companyDot}
                  style={{ background: store?.color || palette[0] }}
                />
                {store?.name || t('Unknown company', 'ไม่พบบริษัท')}
              </span>
              <span>
                {postCounts.get(group.id) ?? 0} {t('posts', 'โพสต์')}
              </span>
            </div>
            <div className={styles.cardFooter}>
              {groupUrl ? (
                <a
                  className={styles.textLink}
                  href={groupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('Open group', 'เปิดกลุ่ม')}
                  <ExternalLink size={16} />
                </a>
              ) : (
                <span className={styles.muted}>
                  {t(
                    'Add a valid Facebook ID to open',
                    'เพิ่มรหัส Facebook ที่ถูกต้องเพื่อเปิดกลุ่ม',
                  )}
                </span>
              )}
              <span className={styles.facebookLabel}>facebook</span>
            </div>
          </article>
        );
      }),
    [groups, companiesById, postCounts, t, begin, moveToTrash],
  );
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    if (
      !entityEditIsCurrent(
        editingBaseline,
        data.groups.find((group) => group.id === editing.id),
      )
    ) {
      setError(
        t(
          'This group changed in another tab. Your edits are still here. Copy them before reopening the latest group.',
          'กลุ่มนี้ถูกแก้ไขในแท็บอื่น การแก้ไขของคุณยังอยู่ที่นี่ คัดลอกข้อมูลที่ต้องการเก็บไว้ก่อนเปิดกลุ่มเวอร์ชันล่าสุด',
        ),
      );
      return;
    }
    const name = editing.name.trim();
    const facebookId = editing.facebookId.trim();
    if (facebookIdLocked && facebookId !== originalGroup?.facebookId) {
      setError(
        t(
          'This group ID cannot change because existing Post IDs depend on it, including posts in Trash.',
          'เปลี่ยนรหัสกลุ่มนี้ไม่ได้ เพราะ Post ID ที่บันทึกไว้เชื่อมกับรหัสนี้ รวมถึงโพสต์ในถังขยะ',
        ),
      );
      return;
    }
    if (
      !name ||
      (facebookId ? !/^\d{1,40}$/.test(facebookId) : !facebookGroupUrl(editing)) ||
      !data.companies.some((store) => store.id === editing.companyId)
    ) {
      setError(
        t(
          'Add a group name, company, and numeric Facebook ID or a Facebook group link in Posting notes.',
          'กรุณากรอกชื่อกลุ่ม เลือกบริษัท และใส่รหัส Facebook ที่เป็นตัวเลข หรือลิงก์กลุ่ม Facebook ในหมายเหตุการโพสต์',
        ),
      );
      return;
    }
    if (
      data.groups.some(
        (group) =>
          group.id !== editing.id &&
          !group.deletedAt &&
          facebookGroupUrl(group).toLowerCase() === facebookGroupUrl(editing).toLowerCase() &&
          group.companyId === editing.companyId,
      )
    ) {
      setError(
        t(
          'This Facebook group is already saved for this company.',
          'บันทึกกลุ่ม Facebook นี้สำหรับบริษัทนี้แล้ว',
        ),
      );
      return;
    }
    const item = {
      ...editing,
      name,
      facebookId,
      category: editing.category.trim(),
      notes: editing.notes.trim(),
    };
    if (
      !(await update({
        ...data,
        groups: data.groups.some((group) => group.id === item.id)
          ? data.groups.map((group) => (group.id === item.id ? item : group))
          : [...data.groups, item],
      }))
    )
      return;
    closeEditor();
    notify(t('Group saved.', 'บันทึกกลุ่มแล้ว'));
  };
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div>
          <h2>{t('Your communities', 'ชุมชนของคุณ')}</h2>
          <p>
            {t(
              'Keep the right groups close to every company.',
              'จัดกลุ่มเป้าหมายให้พร้อมสำหรับแต่ละบริษัท',
            )}
          </p>
        </div>
        <div className={styles.catalogActions}>
          {actions}
          <button
            ref={addButtonRef}
            className={styles.primaryButton}
            onClick={() => begin()}
            disabled={!data.companies.length}
          >
            <Plus size={19} />
            {t('Add group', 'เพิ่มกลุ่ม')}
          </button>
        </div>
      </div>
      <div className={styles.search}>
        <Search size={19} />
        <input
          aria-label={t('Search groups', 'ค้นหากลุ่ม')}
          placeholder={t('Search groups, categories, or IDs…', 'ค้นหากลุ่ม หมวดหมู่ หรือรหัส…')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span>{groups.length}</span>
      </div>
      {editing && (
        <form className={`${styles.editor} ${styles.groupEditor}`} onSubmit={save} ref={editorRef}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>{t('GROUP DETAILS', 'รายละเอียดกลุ่ม')}</span>
              <h3>
                {data.groups.some((group) => group.id === editing.id)
                  ? t('Edit group', 'แก้ไขกลุ่ม')
                  : t('A new place to connect', 'เพิ่มพื้นที่เข้าถึงลูกค้า')}
              </h3>
            </div>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('Close group editor', 'ปิดการแก้ไขกลุ่ม')}
              onClick={closeEditor}
            >
              <X size={20} />
            </button>
          </div>
          <div className={styles.formGrid}>
            <label>
              {t('Group name', 'ชื่อกลุ่ม')}
              <input
                required
                maxLength={160}
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                placeholder={t('e.g. Coffee lovers Thailand', 'เช่น คนรักกาแฟประเทศไทย')}
              />
            </label>
            <label>
              {t('Company', 'บริษัท')}
              <select
                required
                disabled={linkedPosts}
                value={editing.companyId}
                onChange={(event) => setEditing({ ...editing, companyId: event.target.value })}
              >
                {sortCatalog(data.companies).map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
              {linkedPosts && (
                <small>
                  {t(
                    'This group stays with its company because it has linked posts.',
                    'กลุ่มนี้มีโพสต์ที่เชื่อมอยู่ จึงไม่สามารถเปลี่ยนบริษัทได้',
                  )}
                </small>
              )}
            </label>
            <label>
              {t('Facebook group ID', 'รหัสกลุ่ม Facebook')}
              <input
                required={!facebookGroupUrl({ facebookId: '', notes: editing.notes })}
                inputMode="numeric"
                pattern="[0-9]+"
                maxLength={40}
                readOnly={facebookIdLocked}
                value={editing.facebookId}
                onChange={(event) => {
                  const facebookId = event.target.value;
                  const previousKnownName = knownFacebookGroupName(editing.facebookId);
                  const isAutomaticName =
                    !editing.name.trim() ||
                    editing.name === `Facebook group ${editing.facebookId}` ||
                    (!!previousKnownName && editing.name === previousKnownName);
                  setEditing({
                    ...editing,
                    facebookId,
                    name: isAutomaticName ? knownFacebookGroupName(facebookId) || '' : editing.name,
                  });
                }}
                placeholder="123456789012345"
              />
              <small>
                {facebookIdLocked
                  ? t(
                      'Locked to preserve links for existing Post IDs, including posts in Trash.',
                      'ล็อกรหัสนี้เพื่อรักษาลิงก์ของ Post ID ที่บันทึกไว้ รวมถึงโพสต์ในถังขยะ',
                    )
                  : t(
                      'The numbers after /groups/. For a named link, leave this blank and keep the full Facebook group URL in Posting notes.',
                      'ตัวเลขหลัง /groups/ หากลิงก์ใช้ชื่อแทนตัวเลข ให้เว้นช่องนี้และใส่ลิงก์กลุ่ม Facebook แบบเต็มในหมายเหตุการโพสต์',
                    )}
              </small>
            </label>
            <label>
              {t('Category', 'หมวดหมู่')}
              <input
                maxLength={80}
                value={editing.category}
                onChange={(event) => setEditing({ ...editing, category: event.target.value })}
                placeholder={t('e.g. Food & drink', 'เช่น อาหารและเครื่องดื่ม')}
              />
            </label>
            <label className={styles.fullWidth}>
              {t('Posting notes', 'หมายเหตุการโพสต์')}
              <textarea
                rows={3}
                maxLength={2000}
                value={editing.notes}
                onChange={(event) => setEditing({ ...editing, notes: event.target.value })}
                placeholder={t(
                  'Group rules, best posting times, or useful context…',
                  'กฎของกลุ่ม ช่วงเวลาที่เหมาะกับการโพสต์ หรือข้อมูลที่ควรทราบ…',
                )}
              />
            </label>
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.formActions}>
            <button type="button" className={styles.secondaryButton} onClick={closeEditor}>
              {t('Cancel', 'ยกเลิก')}
            </button>
            <button className={styles.primaryButton} type="submit">
              <Check size={18} />
              {t('Save group', 'บันทึกกลุ่ม')}
            </button>
          </div>
        </form>
      )}
      {groups.length ? (
        <div className={styles.cardGrid}>{groupCards}</div>
      ) : (
        <EmptyState
          title={
            search
              ? t('No groups match your search', 'ไม่พบกลุ่มที่ค้นหา')
              : t('Make room for your communities', 'เริ่มรวบรวมชุมชนของคุณ')
          }
          description={
            search
              ? t(
                  'Try another name, category, or Facebook ID.',
                  'ลองค้นหาชื่อ หมวดหมู่ หรือรหัส Facebook อื่น',
                )
              : t(
                  'Add a Facebook group to organize posts and keep its rules handy.',
                  'เพิ่มกลุ่ม Facebook เพื่อจัดการโพสต์และบันทึกกฎของกลุ่ม',
                )
          }
        />
      )}
    </div>
  );
}

export function SettingsPanel({
  data,
  update,
  t,
  notify,
  repository,
  revision,
}: PanelProps & { repository: WorkspaceRepository; revision: string }) {
  const [pending, setPending] = useState<Workspace | null>(null);
  const preparedRestore = useRef<PreparedWorkspaceLabelRestore | null>(null);
  const liveRevision = useRef(revision);
  liveRevision.current = revision;
  const [restoring, setRestoring] = useState(false);
  const [pendingRevision, setPendingRevision] = useState<string | null>(null);
  const [restoreName, setRestoreName] = useState('');
  const [error, setError] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetRevision, setResetRevision] = useState<string | null>(null);
  const [olderBackups, setOlderBackups] = useState<Array<{ key: string; version: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      setOlderBackups(repository.listOlderBackups());
    } catch {
      // The active workspace can still be used if browser storage is unavailable.
    }
  }, []);
  const downloadJson = (content: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const download = async () => {
    setError('');
    try {
      downloadJson(await exportWorkspaceWithLabels(data), `vetra-workspace-${bangkokToday()}.json`);
      notify(
        t(
          'Backup downloaded, including saved carrier PDFs.',
          'ดาวน์โหลดไฟล์สำรองพร้อม PDF ใบปะหน้าที่บันทึกไว้แล้ว',
        ),
      );
    } catch (cause) {
      setError(
        t(
          'Backup could not be completed. Check that all attached carrier PDFs are available in this browser.',
          'สำรองข้อมูลไม่สำเร็จ โปรดตรวจสอบว่า PDF ใบปะหน้าที่แนบไว้ยังอยู่ในเบราว์เซอร์นี้',
        ) +
          ' ' +
          (cause instanceof Error ? cause.message : ''),
      );
    }
  };
  const downloadOlderBackup = (key: string, version: string) => {
    try {
      const content = repository.readOlderBackup(key);
      if (!content) throw new Error('missing backup');
      downloadJson(content, `vetra-previous-workspace-${version}-${bangkokToday()}.json`);
      notify(t('Previous backup downloaded.', 'ดาวน์โหลดไฟล์สำรองก่อนหน้าแล้ว'));
    } catch {
      setError(
        t(
          'This previous backup is no longer available in this browser.',
          'ไม่พบไฟล์สำรองก่อนหน้านี้ในเบราว์เซอร์แล้ว',
        ),
      );
    }
  };
  const readBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const selectedRevision = revision;
    setError('');
    setPending(null);
    setPendingRevision(null);
    setResetOpen(false);
    preparedRestore.current = null;
    try {
      if (file.size > MAX_LABEL_BACKUP_TEXT_BYTES) throw new Error('size');
      const prepared = await prepareWorkspaceLabelRestore(
        JSON.parse((await file.text()).replace(/^\uFEFF/, '')),
      );
      const parsed = prepared.workspace;
      if (!parsed) throw new Error('invalid');
      setPending(parsed);
      preparedRestore.current = prepared;
      setPendingRevision(selectedRevision);
      setRestoreName(file.name);
    } catch {
      setError(
        t(
          'This backup could not be read. Choose a valid VETRA JSON backup up to 150 MB, including its carrier PDFs.',
          'อ่านไฟล์สำรองนี้ไม่ได้ กรุณาเลือกไฟล์สำรอง JSON ของ VETRA ที่ถูกต้อง ขนาดไม่เกิน 150 MB รวม PDF ใบปะหน้า',
        ),
      );
    }
    event.target.value = '';
  };
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div>
          <h2>{t('Make this space yours', 'จัดการพื้นที่ทำงานของคุณ')}</h2>
          <p>
            {t('Your workspace, your data, your way of working.', 'ข้อมูลและการทำงานในแบบของคุณ')}
          </p>
        </div>
        <span className={styles.localBadge}>
          <LockKeyhole size={16} />
          {t('On this browser', 'ในเบราว์เซอร์นี้')}
        </span>
      </div>
      <div className={styles.settingsGrid}>
        <section className={styles.settingsCard}>
          <span className={styles.settingsIcon}>
            <ShieldCheck size={25} />
          </span>
          <h3>{t('A local workspace', 'พื้นที่ทำงานในเบราว์เซอร์')}</h3>
          <p>
            {t(
              'Your companies, customers, products, orders, carrier PDFs, posts, scripts, and Viewers totals are saved in this browser on this device.',
              'บริษัท ลูกค้า สินค้า ออเดอร์ PDF ใบปะหน้า โพสต์ สคริปต์ และยอดผู้ชมถูกบันทึกในเบราว์เซอร์นี้บนอุปกรณ์นี้',
            )}
          </p>
          <div className={styles.infoNote}>
            <CircleHelp size={20} />
            <p>
              {t(
                'There is no cloud sync or shared team login yet. Clearing browser data can remove your workspace. Download regular backups and keep them somewhere safe.',
                'ยังไม่มีการซิงก์บนคลาวด์หรือบัญชีทีมร่วมกัน การล้างข้อมูลเบราว์เซอร์อาจทำให้ข้อมูลหาย โปรดดาวน์โหลดไฟล์สำรองและเก็บไว้ในที่ปลอดภัย',
              )}
            </p>
          </div>
          <div className={styles.featureLine}>
            <Check size={18} />
            {t('Track published posts and viewers', 'ติดตามโพสต์ที่เผยแพร่แล้วและยอดผู้ชม')}
          </div>
          <div className={styles.featureLine}>
            <Check size={18} />
            {t('No social account credentials stored', 'ไม่เก็บข้อมูลเข้าสู่ระบบโซเชียลมีเดีย')}
          </div>
        </section>
        <section className={styles.settingsCard}>
          <span className={styles.settingsIcon}>
            <FileJson size={25} />
          </span>
          <h3>{t('Keep a copy of your work', 'เก็บสำเนางานของคุณ')}</h3>
          <p>
            {t(
              'Download a JSON backup of the workspace, including scripts, orders, attached carrier PDFs, shipping settings, and Trash.',
              'ดาวน์โหลดไฟล์สำรอง JSON ของพื้นที่ทำงาน รวมสคริปต์ ออเดอร์ PDF ใบปะหน้าที่แนบไว้ การตั้งค่าจัดส่ง และถังขยะ',
            )}
          </p>
          <div className={styles.backupButtons}>
            <button className={styles.primaryButton} onClick={download}>
              <ArrowDownToLine size={18} />
              {t('Download backup', 'ดาวน์โหลดไฟล์สำรอง')}
            </button>
            <button className={styles.secondaryButton} onClick={() => fileRef.current?.click()}>
              <ArrowUpFromLine size={18} />
              {t('Restore backup', 'กู้คืนไฟล์สำรอง')}
            </button>
            <input
              ref={fileRef}
              className={styles.hiddenInput}
              aria-label={t('Choose JSON backup', 'เลือกไฟล์สำรอง JSON')}
              type="file"
              accept=".json,application/json"
              onChange={readBackup}
            />
          </div>
          <p className={styles.smallText}>
            {t(
              'Restore shows a preview before replacing this workspace. Older backups bring back published posts only.',
              'การกู้คืนจะแสดงตัวอย่างก่อนแทนที่พื้นที่ทำงานนี้ ไฟล์สำรองรุ่นก่อนจะกู้คืนเฉพาะโพสต์ที่เผยแพร่แล้ว',
            )}
          </p>
          {olderBackups.length > 0 && (
            <details className={styles.smallText}>
              <summary>{t('Previous local data', 'ข้อมูลเดิมในเบราว์เซอร์')}</summary>
              <p>
                {t(
                  'Your older workspace is still saved in this browser. Download a copy if you need records excluded from the current monitor.',
                  'ข้อมูลพื้นที่ทำงานรุ่นก่อนยังอยู่ในเบราว์เซอร์นี้ ดาวน์โหลดสำเนาหากต้องการรายการที่ไม่แสดงในหน้าติดตามปัจจุบัน',
                )}
              </p>
              <div className={styles.backupButtons}>
                {olderBackups.map(({ key, version }) => (
                  <button
                    className={styles.secondaryButton}
                    key={key}
                    onClick={() => downloadOlderBackup(key, version)}
                  >
                    <ArrowDownToLine size={17} />
                    {t(`Download ${version} copy`, `ดาวน์โหลดสำเนา ${version}`)}
                  </button>
                ))}
              </div>
            </details>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
      {pending && (
        <section
          className={styles.confirmPanel}
          aria-label={t('Review backup restore', 'ตรวจสอบการกู้คืนไฟล์สำรอง')}
        >
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>
                {t('REVIEW BEFORE RESTORING', 'ตรวจสอบก่อนกู้คืน')}
              </span>
              <h3>{restoreName}</h3>
            </div>
            <button
              className={styles.iconButton}
              aria-label={t('Cancel restore', 'ยกเลิกการกู้คืน')}
              onClick={() => {
                setPending(null);
                setPendingRevision(null);
              }}
            >
              <X size={20} />
            </button>
          </div>
          <div className={styles.restoreStats}>
            <span>
              <strong>{pending.scripts?.length ?? 0}</strong>
              {t('scripts', 'สคริปต์')}
            </span>
            <span>
              <strong>{pending.orders?.length ?? 0}</strong>
              {t('orders', 'ออเดอร์')}
            </span>
            <span>
              <strong>{pending.products.length}</strong>
              {t('products', 'สินค้า')}
            </span>
            <span>
              <strong>{pending.companies.length}</strong>
              {t('companies', 'บริษัท')}
            </span>
            <span>
              <strong>{pending.customers.length}</strong>
              {t('customers', 'ลูกค้า')}
            </span>
            <span>
              <strong>{pending.groups.length}</strong>
              {t('groups', 'กลุ่ม')}
            </span>
            <span>
              <strong>{pending.posts.length}</strong>
              {t('published posts', 'โพสต์ที่เผยแพร่แล้ว')}
            </span>
          </div>
          <p>
            {t(
              'Restoring replaces all data in the current workspace. Download a backup of your current work first if you want to keep it.',
              'การกู้คืนจะแทนที่ข้อมูลทั้งหมดในพื้นที่ทำงานปัจจุบัน หากต้องการเก็บข้อมูลเดิม โปรดดาวน์โหลดไฟล์สำรองก่อน',
            )}
          </p>
          {pendingRevision !== revision && (
            <p className={styles.error} role="alert">
              {t(
                'This workspace changed while you reviewed the backup. Check the latest data and select the backup again before replacing it.',
                'พื้นที่ทำงานมีการเปลี่ยนแปลงระหว่างตรวจสอบไฟล์สำรอง กรุณาตรวจสอบข้อมูลล่าสุดและเลือกไฟล์สำรองอีกครั้งก่อนแทนที่',
              )}
            </p>
          )}
          <div className={styles.formActions}>
            <button className={styles.secondaryButton} onClick={download}>
              {t('Back up current data', 'สำรองข้อมูลปัจจุบัน')}
            </button>
            <button
              className={styles.dangerButton}
              disabled={restoring}
              onClick={async () => {
                if (pendingRevision !== liveRevision.current || !preparedRestore.current) return;
                setRestoring(true);
                try {
                  await preparedRestore.current.commitLabels();
                  if (pendingRevision !== liveRevision.current) return;
                  if (!(await update(pending))) return;
                  preparedRestore.current = null;
                  setPending(null);
                  setPendingRevision(null);
                  notify(t('Backup restored.', 'กู้คืนไฟล์สำรองแล้ว'));
                } catch {
                  setError(
                    t(
                      'The backup could not be restored. Your current workspace has been preserved.',
                      'กู้คืนไฟล์สำรองไม่ได้ ข้อมูลพื้นที่ทำงานปัจจุบันยังคงอยู่',
                    ),
                  );
                } finally {
                  setRestoring(false);
                }
              }}
            >
              {t('Confirm replacement', 'ยืนยันการแทนที่ข้อมูล')}
            </button>
          </div>
        </section>
      )}
      <section className={styles.settingsCard}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>{t('YOUR CHANNELS', 'ช่องทางของคุณ')}</span>
            <h3>{t('Built around your workflow', 'พร้อมสำหรับขั้นตอนการทำงานของคุณ')}</h3>
          </div>
          <Globe2 size={24} className={styles.muted} />
        </div>
        <div className={styles.platformGrid}>
          <div className={styles.platform}>
            <span className={styles.platformSymbol}>f</span>
            <div>
              <strong>Facebook</strong>
              <span>{t('Manual tracking', 'ติดตามด้วยตนเอง')}</span>
            </div>
            <span className={styles.available}>
              <Check size={15} />
              {t('Available', 'พร้อมใช้งาน')}
            </span>
          </div>
          {['Instagram', 'TikTok', 'LinkedIn'].map((name) => (
            <div className={styles.platform} key={name}>
              <span className={styles.futureSymbol}>
                <Layers3 size={20} />
              </span>
              <div>
                <strong>{name}</strong>
                <span>{t('Future integration', 'การเชื่อมต่อในอนาคต')}</span>
              </div>
            </div>
          ))}
        </div>
        <p className={styles.smallText}>
          {t(
            'Add posts that already exist, with their actual publication date and link or Facebook IDs. Record viewer counts as they change. Live analytics is not connected.',
            'เพิ่มโพสต์ที่เผยแพร่แล้วพร้อมวันที่เผยแพร่จริงและลิงก์หรือรหัส Facebook จากนั้นบันทึกยอดผู้ชมเมื่อมีการเปลี่ยนแปลง ยังไม่มีการเชื่อมต่อข้อมูลวิเคราะห์แบบสด',
          )}
        </p>
      </section>
      {data.sample && (
        <section className={styles.resetCard}>
          <div>
            <h3>
              {t('Ready for your own workspace?', 'พร้อมเริ่มพื้นที่ทำงานของคุณแล้วหรือยัง?')}
            </h3>
            <p>
              {t(
                'Start fresh when you have finished exploring the demo.',
                'เริ่มใหม่เมื่อทดลองใช้ข้อมูลตัวอย่างเรียบร้อยแล้ว',
              )}
            </p>
          </div>
          <button
            className={styles.secondaryButton}
            onClick={() => {
              setResetOpen(true);
              setResetRevision(revision);
              setPending(null);
              setPendingRevision(null);
            }}
          >
            {t('Start with empty workspace', 'เริ่มด้วยพื้นที่ทำงานว่าง')}
          </button>
          {resetOpen && (
            <div className={styles.resetConfirm}>
              <p>
                {t(
                  'This replaces the current workspace with the VETRA STORE company and no customers, products, posts, scripts, orders, or groups. Download a backup first to keep your work.',
                  'พื้นที่ทำงานปัจจุบันจะถูกแทนที่ด้วยบริษัท VETRA STORE โดยไม่มีลูกค้า สินค้า กลุ่ม โพสต์ สคริปต์ หรือออเดอร์ โปรดดาวน์โหลดไฟล์สำรองก่อนเพื่อเก็บข้อมูลไว้',
                )}
              </p>
              {resetRevision !== revision && (
                <p className={styles.error} role="alert">
                  {t(
                    'This workspace changed while you reviewed the reset. Check the latest data and open this confirmation again.',
                    'พื้นที่ทำงานมีการเปลี่ยนแปลงระหว่างตรวจสอบการเริ่มใหม่ กรุณาตรวจสอบข้อมูลล่าสุดและเปิดหน้าต่างยืนยันนี้อีกครั้ง',
                  )}
                </p>
              )}
              <div className={styles.formActions}>
                <button className={styles.secondaryButton} onClick={() => setResetOpen(false)}>
                  {t('Cancel', 'ยกเลิก')}
                </button>
                <button className={styles.secondaryButton} onClick={download}>
                  {t('Download backup', 'ดาวน์โหลดไฟล์สำรอง')}
                </button>
                <button
                  className={styles.dangerButton}
                  onClick={async () => {
                    if (resetRevision !== revision) return;
                    if (
                      !(await update({
                        ...createEmptyWorkspace(),
                        appliedDataUpdates: data.appliedDataUpdates,
                      }))
                    )
                      return;
                    setResetOpen(false);
                    setResetRevision(null);
                    notify(
                      t(
                        'Your workspace is ready. Add your first published post to begin.',
                        'พื้นที่ทำงานพร้อมแล้ว เริ่มด้วยการเพิ่มโพสต์ที่เผยแพร่แล้วรายการแรก',
                      ),
                    );
                  }}
                >
                  {t('Confirm and start fresh', 'ยืนยันและเริ่มใหม่')}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export function TrashPanel({ data, companyId, update, t, notify }: PanelProps) {
  const restoringRef = useRef(false);
  const [restoring, setRestoring] = useState(false);
  const now = Date.now();
  const retention = 30 * 24 * 60 * 60 * 1000;
  const productCompaniesById = useMemo(
    () => productCompanyIdMap(data.products, data.posts),
    [data.products, data.posts],
  );
  const entries = [
    ...(data.scripts ?? [])
      .filter((item) => item.deletedAt)
      .map((item) => ({ ...item, name: item.title, type: 'script' as const })),
    ...(data.orders ?? [])
      .filter((item) => item.deletedAt && visibleInCompany(item, companyId))
      .map((item) => ({ ...item, name: item.number, type: 'order' as const })),
    ...data.customers
      .filter((item) => item.deletedAt && visibleInCompany(item, companyId))
      .map((item) => ({ ...item, type: 'customer' as const })),
    ...data.products
      .filter(
        (item) =>
          item.deletedAt &&
          (companyId === 'all' || productCompaniesById.get(item.id)?.includes(companyId)),
      )
      .map((item) => ({ ...item, companyId: '', type: 'product' as const })),
    ...data.posts
      .filter((item) => item.deletedAt && visibleInCompany(item, companyId))
      .map((item) => ({
        ...item,
        type: 'post' as const,
        name: item.product || item.title || 'Post',
      })),
    ...data.groups
      .filter((item) => item.deletedAt && visibleInCompany(item, companyId))
      .map((item) => ({ ...item, type: 'group' as const })),
  ]
    .filter((item) => now - new Date(item.deletedAt!).getTime() < retention)
    .sort((a, b) => new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime());
  const restore = async (
    id: string,
    type: 'post' | 'group' | 'product' | 'customer' | 'order' | 'script',
  ) => {
    if (restoringRef.current) return;
    const entry = entries.find((item) => item.id === id && item.type === type);
    if (!entry || Date.now() - new Date(entry.deletedAt!).getTime() >= retention) {
      notify(t('This item is no longer available to restore.', 'รายการนี้ไม่สามารถกู้คืนได้แล้ว'));
      return;
    }
    let next: Workspace;
    if (type === 'script') {
      next = {
        ...data,
        scripts: (data.scripts ?? []).map((item) =>
          item.id === id ? { ...item, deletedAt: undefined } : item,
        ),
      };
    } else if (type === 'order') {
      next = {
        ...data,
        orders: (data.orders ?? []).map((item) =>
          item.id === id ? { ...item, deletedAt: undefined } : item,
        ),
      };
    } else if (type === 'customer') {
      next = {
        ...data,
        customers: data.customers.map((item) =>
          item.id === id ? { ...item, deletedAt: undefined } : item,
        ),
      };
    } else if (type === 'product') {
      next = {
        ...data,
        products: data.products.map((item) =>
          item.id === id ? { ...item, deletedAt: undefined } : item,
        ),
      };
    } else if (type === 'group') {
      next = {
        ...data,
        groups: data.groups.map((item) =>
          item.id === id ? { ...item, deletedAt: undefined } : item,
        ),
      };
    } else {
      const post = data.posts.find((item) => item.id === id);
      next = {
        ...data,
        posts: data.posts.map((item) =>
          item.id === id ? { ...item, deletedAt: undefined } : item,
        ),
        groups: data.groups.map((item) =>
          item.id === post?.groupId &&
          item.deletedAt &&
          now - new Date(item.deletedAt).getTime() < retention
            ? { ...item, deletedAt: undefined }
            : item,
        ),
      };
    }
    restoringRef.current = true;
    setRestoring(true);
    try {
      if (await update(next))
        notify(t('Restored to your workspace.', 'กู้คืนกลับสู่พื้นที่ทำงานแล้ว'));
    } catch {
      notify(
        t(
          'Could not restore this item. Please try again.',
          'กู้คืนรายการไม่สำเร็จ โปรดลองอีกครั้ง',
        ),
      );
    } finally {
      restoringRef.current = false;
      setRestoring(false);
    }
  };
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div>
          <h2>{t('A little room to undo', 'ยังมีเวลากู้คืน')}</h2>
          <p>
            {t(
              'Deleted scripts, orders, customers, products, posts, and groups stay here for 30 days.',
              'สคริปต์ ออเดอร์ ลูกค้า สินค้า โพสต์ และกลุ่มที่ลบจะถูกเก็บไว้ที่นี่ 30 วัน',
            )}
          </p>
        </div>
        <span className={styles.localBadge}>
          <Trash2 size={16} />
          {entries.length} {t(entries.length === 1 ? 'item' : 'items', 'รายการ')}
        </span>
      </div>
      <div className={styles.infoNote}>
        <ArchiveRestore size={21} />
        <p>
          {t(
            'Restore an item before its 30-day retention ends. Expired items are removed automatically when the workspace is loaded.',
            'กู้คืนรายการก่อนครบ 30 วัน รายการที่หมดอายุจะถูกลบอัตโนมัติเมื่อเปิดพื้นที่ทำงาน',
          )}
        </p>
      </div>
      {entries.length ? (
        <div className={styles.trashList}>
          {entries.map((entry) => {
            const store = data.companies.find((item) => item.id === entry.companyId);
            const productCompanyNames =
              entry.type === 'product'
                ? (productCompaniesById.get(entry.id) ?? [])
                    .map((id) => data.companies.find((item) => item.id === id)?.name)
                    .filter(Boolean)
                    .join(', ')
                : '';
            const days = Math.max(
              1,
              Math.ceil((retention - (now - new Date(entry.deletedAt!).getTime())) / 86400000),
            );
            return (
              <article className={styles.trashRow} key={`${entry.type}-${entry.id}`}>
                <span className={styles.trashIcon}>
                  {entry.type === 'script' ? (
                    <Code2 size={22} />
                  ) : entry.type === 'customer' ? (
                    <UserRound size={22} />
                  ) : entry.type === 'product' ? (
                    <Package size={22} />
                  ) : entry.type === 'group' ? (
                    <UsersRound size={22} />
                  ) : (
                    <FileJson size={22} />
                  )}
                </span>
                <div className={styles.trashInfo}>
                  <h3>{entry.name}</h3>
                  <p>
                    {entry.type === 'script'
                      ? t('Script', 'สคริปต์')
                      : entry.type === 'order'
                        ? t('Order', 'ออเดอร์')
                        : entry.type === 'customer'
                          ? t('Customer', 'ลูกค้า')
                          : entry.type === 'product'
                            ? t('Product', 'สินค้า')
                            : entry.type === 'group'
                              ? t('Group', 'กลุ่ม')
                              : t('Post', 'โพสต์')}
                    {entry.type !== 'script' && (
                      <>
                        <span>·</span>
                        {entry.type === 'product'
                          ? productCompanyNames || t('Company not assigned', 'ยังไม่ได้กำหนดบริษัท')
                          : store?.name}
                      </>
                    )}
                    <span>·</span>
                    {t('Deleted', 'ลบเมื่อ')}{' '}
                    {formatCalendarDate(bangkokCalendarNow('date', new Date(entry.deletedAt!)))}
                  </p>
                </div>
                <span className={styles.daysLeft}>
                  {days} {t('days left', 'วันเหลือ')}
                </span>
                <button
                  className={styles.secondaryButton}
                  disabled={restoring}
                  onClick={() => restore(entry.id, entry.type)}
                >
                  <ArchiveRestore size={17} />
                  {t('Restore', 'กู้คืน')}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title={t('Nothing in the bin', 'ถังขยะว่างอยู่')}
          description={t(
            'Deleted scripts, orders, customers, products, posts, and groups will appear here, ready to restore.',
            'สคริปต์ ออเดอร์ ลูกค้า สินค้า โพสต์ และกลุ่มที่ลบจะแสดงที่นี่ เพื่อให้คุณกู้คืนได้',
          )}
        />
      )}
    </div>
  );
}
