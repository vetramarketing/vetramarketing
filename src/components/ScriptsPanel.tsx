'use client';

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Facebook,
  Files,
  Instagram,
  ListFilter,
  Maximize2,
  Music2,
  Pencil,
  Pin,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  SCRIPT_LIMITS,
  SCRIPT_PLATFORMS,
  createConsoleScript,
  scriptMatchesQuery,
  type ConsoleScript,
  type ScriptPlatform,
} from '@/lib/console-scripts';
import { bangkokCalendarNow, formatCalendarDate } from '@/lib/calendar';
import { copyScriptCode } from '@/lib/script-clipboard';
import type { Translate, Workspace } from '@/lib/types';
import { SelectionControl } from './SelectionDialog';
import post from './MarketingApp.module.css';
import list from './WorkspaceList.module.css';
import s from './ScriptsPanel.module.css';

interface Props {
  readOnly?: boolean;
  data: Workspace;
  update: (next: Workspace) => Promise<boolean>;
  t: Translate;
  notify: (message: string) => void;
  onEdit: (initial: ConsoleScript, isNew: boolean) => void;
  onEditCode: (initial: ConsoleScript) => void;
}

const PAGE_SIZE = 20;
const platformNames: Record<ScriptPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
};
const platformIcons = { facebook: Facebook, instagram: Instagram, tiktok: Music2 };
const platformOptions = [
  { value: 'all' as const, en: 'All platforms', th: 'ทุกแพลตฟอร์ม' },
  ...SCRIPT_PLATFORMS.map((platform) => ({
    value: platform,
    en: platformNames[platform],
    th: platformNames[platform],
  })),
];
const sortOptions = [
  { value: 'updated' as const, en: 'Recently updated', th: 'แก้ไขล่าสุด' },
  { value: 'title' as const, en: 'Title A–Z', th: 'ชื่อ ก–ฮ' },
];

export default function ScriptsPanel({
  data,
  update,
  t,
  notify,
  onEdit,
  onEditCode,
  readOnly,
}: Props) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const searchPending = query !== deferredQuery;
  const [platform, setPlatform] = useState<ScriptPlatform | 'all'>('all');
  const [sort, setSort] = useState<'updated' | 'title'>('updated');
  const [page, setPage] = useState(0);
  const [saving, setBusy] = useState(false);
  const busy = saving || !!readOnly;
  const busyRef = useRef(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const copyingRef = useRef(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const helpId = useId();
  const activeScripts = useMemo(
    () => (data.scripts ?? []).filter((script) => !script.deletedAt),
    [data.scripts],
  );
  const locale = t('en', 'th');
  const visible = useMemo(() => {
    const result = activeScripts.filter(
      (script) =>
        (platform === 'all' || script.platform === platform) &&
        scriptMatchesQuery(script, deferredQuery),
    );
    result.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (sort === 'title'
          ? a.title.localeCompare(b.title, locale)
          : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) ||
        a.id.localeCompare(b.id),
    );
    return result;
  }, [activeScripts, platform, deferredQuery, sort, locale]);
  const displayedPage = Math.min(page, Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1));
  const rows = visible.slice(displayedPage * PAGE_SIZE, (displayedPage + 1) * PAGE_SIZE);
  const filtersActive = !!query.trim() || platform !== 'all';
  const selectedPlatform = platformOptions.find((option) => option.value === platform)!;
  const selectedSort = sortOptions.find((option) => option.value === sort)!;

  useEffect(() => {
    setPage(0);
  }, [deferredQuery, platform, sort]);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  function openNew() {
    const initial = createConsoleScript('', crypto.randomUUID());
    if (platform !== 'all') initial.platform = platform;
    onEdit(initial, true);
  }

  function duplicate(script: ConsoleScript) {
    const now = new Date().toISOString();
    const suffix = t(' (copy)', ' (สำเนา)');
    const initial: ConsoleScript = {
      ...script,
      id: crypto.randomUUID(),
      companyId: '',
      title: script.title.slice(0, SCRIPT_LIMITS.title - suffix.length) + suffix,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    delete initial.deletedAt;
    onEdit(initial, true);
  }

  async function togglePin(script: ConsoleScript) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const saved = await update({
        ...data,
        scripts: (data.scripts ?? []).map((item) =>
          item.id === script.id
            ? {
                ...item,
                pinned: !item.pinned,
                updatedAt: new Date(Math.max(Date.now(), Date.parse(item.updatedAt))).toISOString(),
              }
            : item,
        ),
      });
      if (saved)
        notify(
          script.pinned
            ? t('Script unpinned.', 'เลิกปักหมุดสคริปต์แล้ว')
            : t('Script pinned.', 'ปักหมุดสคริปต์แล้ว'),
        );
    } catch {
      notify(
        t(
          'Could not save the pin change. Please try again.',
          'บันทึกการปักหมุดไม่สำเร็จ กรุณาลองอีกครั้ง',
        ),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function copyCode(script: ConsoleScript) {
    if (copyingRef.current || !script.code.trim()) return;
    copyingRef.current = true;
    setCopyingId(script.id);
    try {
      await copyScriptCode(script.code);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      setCopiedId(script.id);
      copiedTimer.current = setTimeout(() => setCopiedId(null), 2400);
      notify(t('JavaScript copied.', 'คัดลอก JavaScript แล้ว'));
    } catch {
      notify(
        t(
          'Clipboard access failed. Open the script and select the code to copy manually.',
          'คัดลอกไม่สำเร็จ กรุณาเปิดสคริปต์แล้วเลือกโค้ดเพื่อคัดลอกด้วยตนเอง',
        ),
      );
    } finally {
      copyingRef.current = false;
      setCopyingId(null);
    }
  }

  function exportScripts() {
    if (!visible.length || searchPending) return;
    const text = visible
      .map((script) =>
        [
          script.title,
          `${t('Platform', 'แพลตฟอร์ม')}: ${platformNames[script.platform]}`,
          ...(script.description ? ['', script.description] : []),
          '',
          '----- JavaScript -----',
          script.code,
          '----- /JavaScript -----',
        ].join('\n'),
      )
      .join('\n\n========================================\n\n');
    let url: string | null = null;
    try {
      url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `vetra-scripts-${bangkokCalendarNow()}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      notify(t('Text export started.', 'เริ่มดาวน์โหลดไฟล์ข้อความแล้ว'));
    } catch {
      notify(
        t('Could not export scripts. Please try again.', 'ส่งออกสคริปต์ไม่สำเร็จ กรุณาลองอีกครั้ง'),
      );
    } finally {
      if (url) {
        const objectUrl = url;
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    }
  }

  function resetFilters() {
    setQuery('');
    setPlatform('all');
    searchInput.current?.focus();
  }

  function changePage(nextPage: number) {
    setPage(nextPage);
    requestAnimationFrame(() => {
      resultsRef.current?.focus({ preventScroll: true });
      resultsRef.current?.scrollIntoView({ block: 'start' });
    });
  }

  return (
    <>
      <section className={list.panel} aria-labelledby={titleId}>
        <header className={list.header}>
          <div className={s.heading}>
            <h1 className={list.title} id={titleId}>
              {t('Script library', 'คลังสคริปต์')}
            </h1>
            <p>
              {t(
                'Save JavaScript snippets for your browser console.',
                'เก็บโค้ด JavaScript สำหรับใช้งานในคอนโซลของเบราว์เซอร์',
              )}
            </p>
          </div>
          <div className={list.actions}>
            <button
              className={list.action}
              type="button"
              onClick={exportScripts}
              disabled={!visible.length || searchPending}
            >
              <Download size={18} aria-hidden="true" />
              {t('Export text', 'ส่งออกข้อความ')}
            </button>
            <button
              className={list.primaryAction}
              type="button"
              aria-haspopup="dialog"
              onClick={openNew}
              disabled={busy}
            >
              <Plus size={18} aria-hidden="true" />
              {t('New script', 'เพิ่มสคริปต์')}
            </button>
          </div>
        </header>

        <div className={s.summary}>
          <span className={s.summaryIcon}>
            <Code2 size={22} aria-hidden="true" />
          </span>
          <div>
            <strong>{activeScripts.length.toLocaleString('en-US')}</strong>
            <span>{t('saved scripts', 'สคริปต์ที่บันทึกไว้')}</span>
          </div>
        </div>

        <div className={list.filters}>
          <div className={list.searchControl}>
            <div className={list.search}>
              <Search size={19} aria-hidden="true" />
              <input
                ref={searchInput}
                type="search"
                aria-label={t('Search scripts', 'ค้นหาสคริปต์')}
                aria-describedby={helpId}
                placeholder={t(
                  'Search title, description, or code…',
                  'ค้นหาชื่อ คำอธิบาย หรือโค้ด…',
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
              {query && (
                <button
                  type="button"
                  className={list.clearSearch}
                  aria-label={t('Clear script search', 'ล้างคำค้นหาสคริปต์')}
                  onClick={() => {
                    setQuery('');
                    searchInput.current?.focus();
                  }}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              )}
            </div>
            <p id={helpId} className={list.searchHelp}>
              {t(
                'Search saved code, descriptions, and platforms.',
                'ค้นหาจากโค้ดที่บันทึกไว้ คำอธิบาย หรือแพลตฟอร์ม',
              )}
            </p>
          </div>
          <div className={list.filterControls}>
            <SelectionControl
              title={t('Filter by platform', 'กรองตามแพลตฟอร์ม')}
              options={platformOptions}
              value={platform}
              t={t}
              onSelect={setPlatform}
              trigger={(open, openDialog) => (
                <button
                  type="button"
                  className={list.filterButton}
                  data-active={platform !== 'all'}
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  aria-label={`${t('Filter by platform', 'กรองตามแพลตฟอร์ม')}: ${t(selectedPlatform.en, selectedPlatform.th)}`}
                  onClick={openDialog}
                >
                  <ListFilter size={18} aria-hidden="true" />
                  <span>{t(selectedPlatform.en, selectedPlatform.th)}</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              )}
            />
            <SelectionControl
              title={t('Sort scripts', 'เรียงลำดับสคริปต์')}
              options={sortOptions}
              value={sort}
              t={t}
              onSelect={setSort}
              trigger={(open, openDialog) => (
                <button
                  type="button"
                  className={list.filterButton}
                  aria-haspopup="dialog"
                  aria-expanded={open}
                  aria-label={`${t('Sort scripts', 'เรียงลำดับสคริปต์')}: ${t(selectedSort.en, selectedSort.th)}`}
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

        <div
          ref={resultsRef}
          className={s.results}
          aria-busy={searchPending}
          aria-label={t('Script results', 'ผลการค้นหาสคริปต์')}
          role="region"
          tabIndex={-1}
        >
          {rows.length ? (
            <ul className={s.scriptList} aria-label={t('Saved scripts', 'สคริปต์ที่บันทึกไว้')}>
              {rows.map((script) => {
                const PlatformIcon = platformIcons[script.platform];
                const updatedDate = formatCalendarDate(
                  bangkokCalendarNow('date', new Date(script.updatedAt)),
                );
                const copied = copiedId === script.id;
                return (
                  <li key={script.id} className={s.row}>
                    <div className={s.rowTools}>
                      <button
                        type="button"
                        className={`${post.iconButton} ${post.pinButton} ${script.pinned ? post.pinActive : ''}`}
                        aria-label={`${script.pinned ? t('Unpin script', 'เลิกปักหมุดสคริปต์') : t('Pin script', 'ปักหมุดสคริปต์')} — ${script.title}`}
                        title={
                          script.pinned
                            ? t('Unpin script', 'เลิกปักหมุดสคริปต์')
                            : t('Pin script', 'ปักหมุดสคริปต์')
                        }
                        aria-pressed={script.pinned}
                        disabled={busy}
                        onClick={() => void togglePin(script)}
                      >
                        <Pin
                          size={20}
                          strokeWidth={2.2}
                          fill={script.pinned ? 'currentColor' : 'none'}
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                    <div className={s.scriptInfo}>
                      <div className={s.scriptHeading}>
                        <span className={s.platformBadge} data-platform={script.platform}>
                          <PlatformIcon size={15} aria-hidden="true" />
                          {platformNames[script.platform]}
                        </span>
                        {readOnly ? (
                          <details>
                            <summary>{script.title}</summary>
                            {script.description && <p>{script.description}</p>}
                            <pre className={s.readOnlyCode}>{script.code}</pre>
                          </details>
                        ) : (
                          <button
                            type="button"
                            className={s.titleButton}
                            aria-haspopup="dialog"
                            aria-label={`${t('Open script', 'เปิดสคริปต์')} — ${script.title}`}
                            title={script.title}
                            disabled={busy}
                            onClick={() => onEdit(structuredClone(script), false)}
                          >
                            <span>{script.title}</span>
                          </button>
                        )}
                      </div>
                      <div className={s.metadata}>
                        <span>
                          {t('Updated', 'แก้ไข')}{' '}
                          <time dateTime={script.updatedAt}>{updatedDate}</time>
                        </span>
                      </div>
                    </div>
                    <div className={s.rowActions}>
                      <button
                        type="button"
                        className={s.copyButton}
                        disabled={!!copyingId || !script.code.trim()}
                        aria-label={`${t('Copy code', 'คัดลอกโค้ด')} — ${script.title}`}
                        onClick={() => void copyCode(script)}
                      >
                        {copied ? (
                          <Check size={18} aria-hidden="true" />
                        ) : (
                          <Copy size={18} aria-hidden="true" />
                        )}
                        <span>
                          {copied
                            ? t('Copied', 'คัดลอกแล้ว')
                            : copyingId === script.id
                              ? t('Copying…', 'กำลังคัดลอก…')
                              : t('Copy code', 'คัดลอกโค้ด')}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={s.codeButton}
                        aria-haspopup="dialog"
                        aria-label={`${t('Edit code in full screen', 'แก้ไขโค้ดแบบเต็มหน้าจอ')} — ${script.title}`}
                        title={t('Edit code in full screen', 'แก้ไขโค้ดแบบเต็มหน้าจอ')}
                        disabled={busy}
                        onClick={() => onEditCode(structuredClone(script))}
                      >
                        <Maximize2 size={18} aria-hidden="true" />
                        <span>{t('Edit code', 'แก้ไขโค้ด')}</span>
                      </button>
                      <button
                        type="button"
                        className={`${post.iconButton} ${s.duplicateButton}`}
                        aria-haspopup="dialog"
                        aria-label={`${t('Duplicate script', 'ทำสำเนาสคริปต์')} — ${script.title}`}
                        title={t('Duplicate script', 'ทำสำเนาสคริปต์')}
                        disabled={busy}
                        onClick={() => duplicate(script)}
                      >
                        <Files size={18} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`${post.iconButton} ${s.editButton}`}
                        aria-haspopup="dialog"
                        aria-label={`${t('Edit script', 'แก้ไขสคริปต์')} — ${script.title}`}
                        title={t('Edit script', 'แก้ไขสคริปต์')}
                        disabled={busy}
                        onClick={() => onEdit(structuredClone(script), false)}
                      >
                        <Pencil size={18} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className={s.empty}>
              <span className={s.emptyIcon}>
                <Code2 size={32} aria-hidden="true" />
              </span>
              <h2>
                {filtersActive
                  ? t('No matching scripts', 'ไม่พบสคริปต์ที่ตรงกัน')
                  : t('Your scripts, ready to copy', 'รวมสคริปต์ไว้ พร้อมคัดลอกใช้งาน')}
              </h2>
              <p>
                {filtersActive
                  ? t(
                      'Try another search or clear the platform filter.',
                      'ลองค้นหาใหม่หรือล้างตัวกรองแพลตฟอร์ม',
                    )
                  : t(
                      'Keep JavaScript for Facebook, Instagram, and TikTok organized in one place.',
                      'จัดเก็บ JavaScript สำหรับ Facebook, Instagram และ TikTok ให้เป็นระเบียบในที่เดียว',
                    )}
              </p>
              <button
                type="button"
                className={filtersActive ? list.action : list.primaryAction}
                aria-haspopup={filtersActive ? undefined : 'dialog'}
                disabled={saving || (readOnly && !filtersActive)}
                onClick={filtersActive ? resetFilters : openNew}
              >
                {filtersActive ? (
                  <X size={18} aria-hidden="true" />
                ) : (
                  <Plus size={18} aria-hidden="true" />
                )}
                {filtersActive
                  ? t('Clear filters', 'ล้างตัวกรอง')
                  : t('Add your first script', 'เพิ่มสคริปต์แรก')}
              </button>
            </div>
          )}
        </div>

        <footer className={list.footer}>
          <span role="status" aria-live="polite" aria-atomic="true">
            {searchPending
              ? t('Searching scripts…', 'กำลังค้นหาสคริปต์…')
              : visible.length
                ? t(
                    `${displayedPage * PAGE_SIZE + 1}–${Math.min((displayedPage + 1) * PAGE_SIZE, visible.length)} of ${visible.length} scripts`,
                    `${displayedPage * PAGE_SIZE + 1}–${Math.min((displayedPage + 1) * PAGE_SIZE, visible.length)} จาก ${visible.length} สคริปต์`,
                  )
                : t('0 scripts', '0 สคริปต์')}
          </span>
          {visible.length > PAGE_SIZE ? (
            <nav className={s.pagination} aria-label={t('Script pages', 'หน้ารายการสคริปต์')}>
              <button
                className={s.pageButton}
                type="button"
                disabled={displayedPage === 0 || searchPending}
                onClick={() => changePage(displayedPage - 1)}
              >
                <ChevronLeft size={18} aria-hidden="true" />
                {t('Previous', 'ก่อนหน้า')}
              </button>
              <button
                className={s.pageButton}
                type="button"
                disabled={(displayedPage + 1) * PAGE_SIZE >= visible.length || searchPending}
                onClick={() => changePage(displayedPage + 1)}
              >
                {t('Next', 'ถัดไป')}
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </nav>
          ) : (
            <span>{t('Pinned scripts appear first.', 'สคริปต์ที่ปักหมุดจะแสดงก่อน')}</span>
          )}
        </footer>
      </section>
    </>
  );
}
