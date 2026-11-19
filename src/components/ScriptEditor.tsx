'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Code2, Copy, Download, Save, Trash2, X } from 'lucide-react';
import {
  SCRIPT_LIMITS,
  validateConsoleScripts,
  type ConsoleScript,
  type ScriptPlatform,
} from '@/lib/console-scripts';
import { entityEditIsCurrent } from '@/lib/entity-edit';
import { copyScriptCode } from '@/lib/script-clipboard';
import type { Translate, Workspace } from '@/lib/types';
import SelectionField from './SelectionField';
import post from './PostEditor.module.css';
import list from './WorkspaceList.module.css';
import s from './ScriptEditor.module.css';

export default function ScriptEditor({
  initial,
  data,
  isNew,
  update,
  t,
  notify,
  onClose,
}: {
  initial: ConsoleScript;
  data: Workspace;
  isNew: boolean;
  update: (next: Workspace) => Promise<boolean>;
  t: Translate;
  notify: (message: string) => void;
  onClose: () => void;
}) {
  const [original] = useState(() => structuredClone(initial));
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [confirmation, setConfirmation] = useState<'discard' | 'delete' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const busyRef = useRef(false);
  const closingRef = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const safeAction = useRef<HTMLButtonElement>(null);
  const confirmAction = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const confirmedOnce = useRef(false);
  const headingId = useId();
  const confirmationTitleId = useId();
  const confirmationDescriptionId = useId();
  const codeId = useId();
  const codeHelpId = useId();
  const errorId = useId();
  const dirty = JSON.stringify(original) !== JSON.stringify(draft);
  const confirmingDelete = confirmation === 'delete';
  const platformName = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' }[
    draft.platform
  ];

  useLayoutEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (element && !element.open) element.showModal();
    titleField.current?.focus({ preventScroll: true });
    return () => {
      if (element?.open) element.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    if (confirmation) {
      confirmedOnce.current = true;
      safeAction.current?.focus({ preventScroll: true });
    } else if (confirmedOnce.current) {
      (lastFocus.current ?? titleField.current)?.focus({ preventScroll: true });
      confirmedOnce.current = false;
    }
  }, [confirmation]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  function finishClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    dialog.current?.close();
    onClose();
  }

  function confirm(action: 'discard' | 'delete') {
    lastFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError('');
    setConfirmation(action);
  }

  function requestClose() {
    if (busyRef.current || closingRef.current) return;
    if (confirmation) {
      setConfirmation(null);
      setError('');
      return;
    }
    if (dirty) confirm('discard');
    else finishClose();
  }

  function field<K extends keyof ConsoleScript>(key: K, value: ConsoleScript[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save(deleting = false) {
    if (
      busyRef.current ||
      closingRef.current ||
      confirmation === 'discard' ||
      (deleting && confirmation !== 'delete')
    )
      return;
    const current = data.scripts?.find((item) => item.id === original.id);
    if (!entityEditIsCurrent(isNew ? null : original, current)) {
      setError(
        t(
          'This script changed in another tab. Your edits are still here. Copy your code, then reopen the latest version.',
          'สคริปต์นี้ถูกแก้ไขในแท็บอื่น การแก้ไขของคุณยังอยู่ คัดลอกโค้ดแล้วเปิดเวอร์ชันล่าสุดอีกครั้ง',
        ),
      );
      return;
    }
    if (!deleting && (!draft.title.trim() || !draft.code.trim())) {
      setError(t('Enter a title and JavaScript code.', 'กรอกชื่อและโค้ด JavaScript'));
      return;
    }
    const now = new Date(Math.max(Date.now(), Date.parse(original.updatedAt))).toISOString();
    const candidate: ConsoleScript =
      deleting && current
        ? { ...current, deletedAt: now, updatedAt: now }
        : { ...draft, title: draft.title.trim(), updatedAt: now };
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      validateConsoleScripts([candidate], new Set(data.companies.map((item) => item.id)));
      const scripts = current
        ? (data.scripts ?? []).map((item) => (item.id === candidate.id ? candidate : item))
        : [...(data.scripts ?? []), candidate];
      if (!(await update({ ...data, scripts }))) {
        setError(
          t(
            'Could not save. Your code is still here. Check the workspace message and try again.',
            'บันทึกไม่สำเร็จ โค้ดของคุณยังอยู่ ตรวจสอบข้อความพื้นที่ทำงานแล้วลองอีกครั้ง',
          ),
        );
        return;
      }
      notify(
        deleting
          ? t(
              'Script moved to Trash. Restore it within 30 days.',
              'ย้ายสคริปต์ไปถังขยะแล้ว กู้คืนได้ภายใน 30 วัน',
            )
          : t('Script saved.', 'บันทึกสคริปต์แล้ว'),
      );
      finishClose();
    } catch {
      setError(
        t(
          'Could not save this script. Your code is still here. Check the fields and try again.',
          'บันทึกสคริปต์ไม่สำเร็จ โค้ดของคุณยังอยู่ ตรวจสอบข้อมูลแล้วลองอีกครั้ง',
        ),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function copyCode() {
    if (copying) return;
    setCopying(true);
    try {
      await copyScriptCode(draft.code);
      notify(t('Code copied.', 'คัดลอกโค้ดแล้ว'));
    } catch {
      setError(
        t(
          'Copy was blocked. Select the code and copy it with Ctrl+C or ⌘C.',
          'คัดลอกไม่สำเร็จ เลือกโค้ดแล้วกด Ctrl+C หรือ ⌘C เพื่อคัดลอก',
        ),
      );
    } finally {
      setCopying(false);
    }
  }

  function downloadCode() {
    const url = URL.createObjectURL(
      new Blob([draft.code], { type: 'text/javascript;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${
      draft.title
        .trim()
        .replace(/[^\p{L}\p{N}_-]+/gu, '-')
        .slice(0, 80) || 'script'
    }.js`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <dialog
      ref={dialog}
      className={`${post.dialog} ${confirmation ? post.confirmingDialog : s.editor}`}
      role={confirmation ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-busy={busy || undefined}
      aria-labelledby={confirmation ? confirmationTitleId : headingId}
      aria-describedby={confirmation ? confirmationDescriptionId : undefined}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        ) {
          requestClose();
        }
      }}
      onKeyDown={(event) => {
        if (
          !(event.target instanceof Element) ||
          event.target.closest('dialog') !== event.currentTarget
        )
          return;
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          requestClose();
          return;
        }
        if (confirmation && event.key === 'Tab' && !busy) {
          if (event.shiftKey && document.activeElement === safeAction.current) {
            event.preventDefault();
            confirmAction.current?.focus();
          } else if (!event.shiftKey && document.activeElement === confirmAction.current) {
            event.preventDefault();
            safeAction.current?.focus();
          }
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !confirmation) {
          event.preventDefault();
          form.current?.requestSubmit();
        }
      }}
    >
      <form
        ref={form}
        className={s.form}
        hidden={!!confirmation}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <header className={post.header}>
          <div>
            <span className={post.eyebrow}>{t('SCRIPT DETAILS', 'รายละเอียดสคริปต์')}</span>
            <h2 id={headingId}>
              {isNew ? t('New script', 'เพิ่มสคริปต์') : t('Edit script', 'แก้ไขสคริปต์')}
            </h2>
            <p>
              {t('JavaScript for your browser console', 'JavaScript สำหรับคอนโซลของเบราว์เซอร์')}
            </p>
          </div>
          <button
            type="button"
            className={post.iconButton}
            onClick={requestClose}
            disabled={busy}
            aria-label={t('Close', 'ปิด')}
          >
            <X size={22} />
          </button>
        </header>
        <div
          className={s.body}
          role="region"
          aria-label={t('Script fields', 'ข้อมูลสคริปต์')}
          tabIndex={0}
        >
          <fieldset className={s.fields} disabled={busy}>
            <div className={s.grid}>
              <label>
                {t('Script title', 'ชื่อสคริปต์')}
                <input
                  ref={titleField}
                  value={draft.title}
                  onChange={(event) => field('title', event.target.value)}
                  maxLength={SCRIPT_LIMITS.title}
                  required
                  placeholder={t('What does this script do?', 'สคริปต์นี้ใช้ทำอะไร?')}
                  autoComplete="off"
                />
              </label>
              <SelectionField
                label={t('Platform', 'แพลตฟอร์ม')}
                value={draft.platform}
                options={[
                  { value: 'facebook' as ScriptPlatform, en: 'Facebook', th: 'Facebook' },
                  { value: 'instagram' as ScriptPlatform, en: 'Instagram', th: 'Instagram' },
                  { value: 'tiktok' as ScriptPlatform, en: 'TikTok', th: 'TikTok' },
                ]}
                onSelect={(value) => field('platform', value)}
                t={t}
                disabled={busy}
              />
              <label className={s.fullWidth}>
                {t('Description / how to use', 'คำอธิบาย / วิธีใช้')}
                <textarea
                  value={draft.description}
                  onChange={(event) => field('description', event.target.value)}
                  maxLength={SCRIPT_LIMITS.description}
                  rows={3}
                  placeholder={t(
                    'Describe what it does and which page to open first.',
                    'อธิบายหน้าที่ของสคริปต์และหน้าที่ต้องเปิดก่อนใช้งาน',
                  )}
                />
              </label>
            </div>
            <div className={s.codeSection}>
              <div className={s.codeHeader}>
                <label htmlFor={codeId}>
                  <Code2 size={18} aria-hidden="true" />
                  {t('JavaScript code', 'โค้ด JavaScript')}
                </label>
                <div className={s.codeActions}>
                  <button
                    type="button"
                    className={list.action}
                    onClick={downloadCode}
                    disabled={!draft.code.trim()}
                    aria-label={t('Download JavaScript file', 'ดาวน์โหลดไฟล์ JavaScript')}
                  >
                    <Download size={16} />
                    .js
                  </button>
                  <button
                    type="button"
                    className={list.action}
                    onClick={() => void copyCode()}
                    disabled={!draft.code.trim() || copying}
                  >
                    <Copy size={16} />
                    {t('Copy code', 'คัดลอกโค้ด')}
                  </button>
                </div>
              </div>
              <textarea
                id={codeId}
                className={s.code}
                value={draft.code}
                onChange={(event) => field('code', event.target.value)}
                maxLength={SCRIPT_LIMITS.code}
                required
                rows={18}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                wrap="off"
                dir="ltr"
                aria-describedby={codeHelpId}
                placeholder={t('// Paste your JavaScript here', '// วางโค้ด JavaScript ที่นี่')}
              />
              <div className={s.codeFooter}>
                <span>
                  {draft.code ? draft.code.split(/\r\n|\r|\n/).length.toLocaleString() : 0}{' '}
                  {t('lines', 'บรรทัด')} · {draft.code.length.toLocaleString()}{' '}
                  {t('characters', 'อักขระ')}
                </span>
                <span>JavaScript</span>
              </div>
            </div>
            <p id={codeHelpId} className={s.help}>
              {t(
                `Copy the code, open ${platformName}, then paste it into the F12 → Console tab.`,
                `คัดลอกโค้ด เปิด ${platformName} แล้ววางในแท็บ Console โดยกด F12`,
              )}
            </p>
          </fieldset>
        </div>
        <footer className={s.footer}>
          {error && (
            <p id={errorId} className={s.error} role="alert">
              {error}
            </p>
          )}
          <div className={s.footerRow}>
            {!isNew && (
              <button
                type="button"
                className={s.trashButton}
                disabled={busy}
                onClick={() => confirm('delete')}
              >
                <Trash2 size={18} />
                {t('Move to Trash', 'ย้ายไปถังขยะ')}
              </button>
            )}
            <div className={s.saveActions}>
              <button type="button" className={list.action} onClick={requestClose} disabled={busy}>
                {t('Cancel', 'ยกเลิก')}
              </button>
              <button
                type="submit"
                className={list.primaryAction}
                disabled={busy}
                title={t('Save · Ctrl+Enter', 'บันทึก · Ctrl+Enter')}
              >
                <Save size={18} />
                {busy ? t('Saving…', 'กำลังบันทึก…') : t('Save script', 'บันทึกสคริปต์')}
              </button>
            </div>
          </div>
        </footer>
      </form>
      {confirmation && (
        <section className={post.discardPanel}>
          <span className={`${post.discardIcon} ${confirmingDelete ? post.deleteIcon : ''}`}>
            {confirmingDelete ? (
              <Trash2 size={25} aria-hidden="true" />
            ) : (
              <AlertTriangle size={25} aria-hidden="true" />
            )}
          </span>
          <h2 id={confirmationTitleId}>
            {confirmingDelete
              ? t('Move script to Trash?', 'ย้ายสคริปต์ไปถังขยะ?')
              : t('Discard changes?', 'ละทิ้งการแก้ไข?')}
          </h2>
          <p id={confirmationDescriptionId}>
            {confirmingDelete
              ? t(
                  'This script can be restored from Trash within 30 days.',
                  'สคริปต์นี้สามารถกู้คืนจากถังขยะได้ภายใน 30 วัน',
                )
              : t('Your unsaved changes will be lost.', 'การแก้ไขที่ยังไม่ได้บันทึกจะหายไป')}
          </p>
          {error && (
            <p className={post.deleteError} role="alert">
              {error}
            </p>
          )}
          <div className={post.discardActions}>
            <button
              ref={safeAction}
              type="button"
              className={post.cancelButton}
              disabled={busy}
              onClick={requestClose}
            >
              {confirmingDelete ? t('Cancel', 'ยกเลิก') : t('Keep editing', 'แก้ไขต่อ')}
            </button>
            <button
              ref={confirmAction}
              type="button"
              className={confirmingDelete ? post.confirmDeleteButton : post.discardButton}
              disabled={busy}
              onClick={() => (confirmingDelete ? void save(true) : finishClose())}
            >
              {busy
                ? t('Saving…', 'กำลังบันทึก…')
                : confirmingDelete
                  ? t('Move to Trash', 'ย้ายไปถังขยะ')
                  : t('Discard changes', 'ละทิ้งการแก้ไข')}
            </button>
          </div>
        </section>
      )}
    </dialog>
  );
}
