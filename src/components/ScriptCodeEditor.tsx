'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Code2, Copy, Save, X } from 'lucide-react';
import { SCRIPT_LIMITS, validateConsoleScripts, type ConsoleScript } from '@/lib/console-scripts';
import { entityEditIsCurrent } from '@/lib/entity-edit';
import { copyScriptCode } from '@/lib/script-clipboard';
import type { Translate, Workspace } from '@/lib/types';
import post from './PostEditor.module.css';
import list from './WorkspaceList.module.css';
import s from './ScriptCodeEditor.module.css';

export default function ScriptCodeEditor({
  initial,
  data,
  update,
  t,
  notify,
  onClose,
}: {
  initial: ConsoleScript;
  data: Workspace;
  update: (next: Workspace) => Promise<boolean>;
  t: Translate;
  notify: (message: string) => void;
  onClose: () => void;
}) {
  const [original] = useState(() => structuredClone(initial));
  const [code, setCode] = useState(initial.code);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const safeAction = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);
  const copyingRef = useRef(false);
  const closingRef = useRef(false);
  const restoreAfterConfirmation = useRef(false);
  const editingPosition = useRef<{
    start: number;
    end: number;
    direction: 'forward' | 'backward' | 'none';
    top: number;
    left: number;
    focus: HTMLElement | null;
  } | null>(null);
  const headingId = useId();
  const confirmationTitleId = useId();
  const confirmationDescriptionId = useId();
  const statisticsId = useId();
  const errorId = useId();
  const dirty = code !== original.code;

  useLayoutEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    const scrollbarGutter = document.documentElement.style.scrollbarGutter;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.scrollbarGutter = 'auto';
    if (element && !element.open) element.showModal();
    textarea.current?.focus({ preventScroll: true });
    textarea.current?.setSelectionRange(0, 0);
    return () => {
      if (element?.open) element.close();
      document.body.style.overflow = overflow;
      document.documentElement.style.scrollbarGutter = scrollbarGutter;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    if (confirming) {
      restoreAfterConfirmation.current = true;
      safeAction.current?.focus({ preventScroll: true });
    } else if (restoreAfterConfirmation.current) {
      restoreAfterConfirmation.current = false;
      const position = editingPosition.current;
      const field = textarea.current;
      const focus = position?.focus?.isConnected ? position.focus : field;
      focus?.focus({ preventScroll: true });
      if (field && position) {
        field.setSelectionRange(position.start, position.end, position.direction);
        field.scrollTop = position.top;
        field.scrollLeft = position.left;
      }
    }
  }, [confirming]);

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

  function requestClose() {
    if (busyRef.current || closingRef.current) return;
    if (confirming) {
      setConfirming(false);
      return;
    }
    if (!dirty) {
      finishClose();
      return;
    }
    const field = textarea.current;
    if (field) {
      editingPosition.current = {
        start: field.selectionStart,
        end: field.selectionEnd,
        direction: field.selectionDirection,
        top: field.scrollTop,
        left: field.scrollLeft,
        focus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      };
    }
    setConfirming(true);
  }

  async function save() {
    if (busyRef.current || closingRef.current || confirming) return;
    const current = data.scripts?.find((script) => script.id === original.id);
    if (!current || current.deletedAt || !entityEditIsCurrent(original, current)) {
      setError(
        t(
          'This script changed in another tab. Your code is still here. Copy it, then reopen the latest version.',
          'สคริปต์นี้ถูกแก้ไขในแท็บอื่น โค้ดของคุณยังอยู่ คัดลอกโค้ดแล้วเปิดเวอร์ชันล่าสุดอีกครั้ง',
        ),
      );
      return;
    }
    if (!code.trim()) {
      setError(t('Enter JavaScript code before saving.', 'กรอกโค้ด JavaScript ก่อนบันทึก'));
      textarea.current?.focus({ preventScroll: true });
      return;
    }
    if (!dirty) {
      finishClose();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const candidate = {
        ...current,
        code,
        updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt))).toISOString(),
      };
      validateConsoleScripts([candidate], new Set(data.companies.map((company) => company.id)));
      const saved = await update({
        ...data,
        scripts: (data.scripts ?? []).map((script) =>
          script.id === candidate.id ? candidate : script,
        ),
      });
      if (!saved) {
        setError(
          t(
            'Could not save. Your code is still here. Check the workspace message and try again.',
            'บันทึกไม่สำเร็จ โค้ดของคุณยังอยู่ ตรวจสอบข้อความพื้นที่ทำงานแล้วลองอีกครั้ง',
          ),
        );
        return;
      }
      notify(t('Code saved.', 'บันทึกโค้ดแล้ว'));
      finishClose();
    } catch {
      setError(
        t(
          'Could not save this code. Your edits are still here. Check the code and try again.',
          'บันทึกโค้ดไม่สำเร็จ การแก้ไขของคุณยังอยู่ ตรวจสอบโค้ดแล้วลองอีกครั้ง',
        ),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function copyCode() {
    if (copyingRef.current) return;
    copyingRef.current = true;
    setCopying(true);
    try {
      await copyScriptCode(code);
      notify(t('Code copied.', 'คัดลอกโค้ดแล้ว'));
    } catch {
      setError(
        t(
          'Copy was blocked. Select the code and copy it with Ctrl+C or ⌘C.',
          'คัดลอกไม่สำเร็จ เลือกโค้ดแล้วกด Ctrl+C หรือ ⌘C เพื่อคัดลอก',
        ),
      );
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className={`${post.dialog} ${confirming ? post.confirmingDialog : s.fullScreen}`}
      role={confirming ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-busy={busy || undefined}
      aria-labelledby={confirming ? confirmationTitleId : headingId}
      aria-describedby={confirming ? confirmationDescriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          requestClose();
        } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !confirming) {
          event.preventDefault();
          form.current?.requestSubmit();
        } else if (event.key === 'Tab') {
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),textarea:not(:disabled)',
            ),
          ).filter((element) => element.getClientRects().length > 0);
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <form
        ref={form}
        className={s.form}
        hidden={confirming}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <header className={s.header}>
          <div className={s.heading}>
            <h2 id={headingId}>
              <Code2 size={23} aria-hidden="true" />
              {t('Code editor', 'แก้ไขโค้ด')}
            </h2>
            <p className={s.scriptName} title={original.title}>
              {original.title}
            </p>
          </div>
          <div className={s.actions}>
            <button
              type="button"
              className={list.action}
              onClick={() => void copyCode()}
              disabled={copying || !code.trim()}
              aria-label={t('Copy code', 'คัดลอกโค้ด')}
              title={t('Copy code', 'คัดลอกโค้ด')}
            >
              <Copy size={18} aria-hidden="true" />
              <span className={s.copyLabel}>{t('Copy code', 'คัดลอกโค้ด')}</span>
            </button>
            <button
              type="button"
              className={post.iconButton}
              onClick={requestClose}
              disabled={busy}
              aria-label={t('Close code editor', 'ปิดหน้าต่างแก้ไขโค้ด')}
            >
              <X size={22} aria-hidden="true" />
            </button>
          </div>
        </header>
        <textarea
          ref={textarea}
          className={s.code}
          aria-label={t('JavaScript code', 'โค้ด JavaScript')}
          aria-describedby={error ? `${statisticsId} ${errorId}` : statisticsId}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          disabled={busy}
          maxLength={SCRIPT_LIMITS.code}
          required
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          wrap="off"
          dir="ltr"
        />
        <footer className={s.footer}>
          {error && (
            <p id={errorId} className={s.error} role="alert">
              {error}
            </p>
          )}
          <div className={s.footerRow}>
            <div id={statisticsId} className={s.statistics}>
              <span>
                {(code ? code.split(/\r\n|\r|\n/).length : 0).toLocaleString()}{' '}
                {t('lines', 'บรรทัด')} · {code.length.toLocaleString()} {t('characters', 'อักขระ')}
              </span>
              <span className={dirty ? s.unsaved : undefined}>
                {dirty ? t('Unsaved changes', 'ยังไม่ได้บันทึกการแก้ไข') : 'JavaScript'}
              </span>
            </div>
            <div className={s.actions}>
              <button type="button" className={list.action} onClick={requestClose} disabled={busy}>
                {t('Cancel', 'ยกเลิก')}
              </button>
              <button
                type="submit"
                className={list.primaryAction}
                disabled={busy}
                title={t('Save · Ctrl+Enter', 'บันทึก · Ctrl+Enter')}
              >
                <Save size={18} aria-hidden="true" />
                {busy ? t('Saving…', 'กำลังบันทึก…') : t('Save code', 'บันทึกโค้ด')}
              </button>
            </div>
          </div>
        </footer>
      </form>
      {confirming && (
        <section className={post.discardPanel}>
          <span className={post.discardIcon}>
            <AlertTriangle size={25} aria-hidden="true" />
          </span>
          <h2 id={confirmationTitleId}>{t('Discard code changes?', 'ละทิ้งการแก้ไขโค้ด?')}</h2>
          <p id={confirmationDescriptionId}>
            {t('Your unsaved code changes will be lost.', 'การแก้ไขโค้ดที่ยังไม่ได้บันทึกจะหายไป')}
          </p>
          <div className={post.discardActions}>
            <button
              ref={safeAction}
              type="button"
              className={post.cancelButton}
              onClick={() => setConfirming(false)}
            >
              {t('Keep editing', 'แก้ไขต่อ')}
            </button>
            <button type="button" className={post.discardButton} onClick={finishClose}>
              {t('Discard changes', 'ละทิ้งการแก้ไข')}
            </button>
          </div>
        </section>
      )}
    </dialog>
  );
}
