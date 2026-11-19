'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { AlertCircle, Check, ExternalLink, Import, ScanSearch, Upload, X } from 'lucide-react';
import { sortCatalog } from '@/lib/catalog';
import {
  MAX_GROUP_HTML_BYTES,
  previewGroupHtmlImport,
  type GroupHtmlImportPreview,
} from '@/lib/group-html-import';
import type { Translate, Workspace } from '@/lib/types';
import styles from './MetaUpdateDialog.module.css';
import s from './GroupHtmlImportDialog.module.css';

type Props = {
  data: Workspace;
  revision: string;
  companyId: string;
  t: Translate;
  onApply: (source: string, companyId: string, previewRevision: string) => Promise<void>;
  onClose: () => void;
};

const PREVIEW_BATCH = 60;

function messageText(message: string, t: Translate): string {
  const translations: Record<string, string> = {
    'Paste the Facebook group outerHTML first.': 'กรุณาวาง outerHTML ของกลุ่ม Facebook ก่อน',
    'Group HTML is too large (10 MB maximum).': 'HTML ของกลุ่มมีขนาดใหญ่เกินไป (สูงสุด 10 MB)',
    'Choose an existing company before importing groups.':
      'กรุณาเลือกบริษัทที่มีอยู่ก่อนนำเข้ากลุ่ม',
    'No Facebook group links were found. Paste the joined-groups outerHTML.':
      'ไม่พบลิงก์กลุ่ม Facebook กรุณาวาง outerHTML ของรายการกลุ่มที่คุณเข้าร่วม',
    'Group HTML has too many groups (10,000 maximum).':
      'HTML มีกลุ่มมากเกินไป (สูงสุด 10,000 กลุ่ม)',
    'The group import preview is stale. Review the HTML again before saving.':
      'ตัวอย่างนำเข้ากลุ่มไม่ใช่ข้อมูลล่าสุด กรุณาตรวจสอบ HTML อีกครั้งก่อนบันทึก',
    'No group name was found for this link.': 'ไม่พบชื่อกลุ่มสำหรับลิงก์นี้',
    'Group name is longer than 200 characters.': 'ชื่อกลุ่มยาวเกิน 200 อักขระ',
    'Group name contains unsupported control characters.': 'ชื่อกลุ่มมีอักขระควบคุมที่ไม่รองรับ',
    'Conflicting group names were found for this link.':
      'พบชื่อกลุ่มที่ไม่ตรงกันสำหรับลิงก์เดียวกัน',
    'More than one saved group matches this link.':
      'มีกลุ่มที่บันทึกไว้มากกว่าหนึ่งรายการตรงกับลิงก์นี้',
    'This group is in Trash. Restore it before importing.':
      'กลุ่มนี้อยู่ในถังขยะ กรุณากู้คืนก่อนนำเข้า',
    'Different source links match the same saved group with conflicting names.':
      'ลิงก์ต้นฉบับต่างกันตรงกับกลุ่มที่บันทึกไว้เดียวกัน แต่ชื่อกลุ่มไม่ตรงกัน',
    'Group catalog is full (10,000 maximum).': 'คลังกลุ่มเต็มแล้ว (สูงสุด 10,000 กลุ่ม)',
  };
  return t(message, translations[message] ?? message);
}

export default function GroupHtmlImportDialog({
  data,
  revision,
  companyId,
  t,
  onApply,
  onClose,
}: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const sourceInput = useRef<HTMLTextAreaElement>(null);
  const companyInput = useRef<HTMLSelectElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewTitle = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  const pendingRead = useRef(0);
  const pendingReview = useRef(0);
  const applyingNow = useRef(false);
  const reviewedSource = useRef('');
  const previousRevision = useRef(revision);
  const latestRevision = useRef(revision);
  latestRevision.current = revision;
  const [destination, setDestination] = useState(() =>
    data.companies.some((company) => company.id === companyId) ? companyId : '',
  );
  const [hasSource, setHasSource] = useState(false);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<GroupHtmlImportPreview | null>(null);
  const [previewRevision, setPreviewRevision] = useState('');
  const [changeLimit, setChangeLimit] = useState(PREVIEW_BATCH);
  const [issueLimit, setIssueLimit] = useState(PREVIEW_BATCH);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reading, setReading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [applying, setApplying] = useState(false);

  useLayoutEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (element && !element.open) element.showModal();
    if (companyInput.current?.value) sourceInput.current?.focus();
    else companyInput.current?.focus();
    return () => {
      mounted.current = false;
      pendingRead.current += 1;
      pendingReview.current += 1;
      element?.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (revision === previousRevision.current) return;
    previousRevision.current = revision;
    invalidatePreview();
    setNotice(
      t(
        'The workspace changed. Preview the groups again before saving.',
        'ข้อมูลในพื้นที่ทำงานเปลี่ยนไป กรุณาดูตัวอย่างกลุ่มอีกครั้งก่อนบันทึก',
      ),
    );
  }, [revision, t]);

  useEffect(() => {
    if (preview) previewTitle.current?.focus();
  }, [preview]);

  function invalidatePreview() {
    pendingReview.current += 1;
    reviewedSource.current = '';
    setPreview(null);
    setPreviewRevision('');
    setReviewing(false);
    setChangeLimit(PREVIEW_BATCH);
    setIssueLimit(PREVIEW_BATCH);
  }

  function sourceChanged() {
    pendingRead.current += 1;
    setReading(false);
    setHasSource(Boolean(sourceInput.current?.value.trim()));
    setFileName('');
    setError('');
    setNotice('');
    invalidatePreview();
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const request = ++pendingRead.current;
    setError('');
    setNotice('');
    invalidatePreview();
    if (!/\.(html?|txt)$/i.test(file.name)) {
      setError(t('Choose an HTML or text file.', 'เลือกไฟล์ HTML หรือไฟล์ข้อความ'));
      return;
    }
    if (file.size > MAX_GROUP_HTML_BYTES) {
      setError(t('Choose a file no larger than 10 MB.', 'เลือกไฟล์ที่มีขนาดไม่เกิน 10 MB'));
      return;
    }
    setReading(true);
    try {
      const content = await file.text();
      if (!mounted.current || request !== pendingRead.current) return;
      if (!content.trim()) {
        setError(t('The selected file is empty.', 'ไฟล์ที่เลือกไม่มีข้อมูล'));
        return;
      }
      if (sourceInput.current) sourceInput.current.value = content;
      setHasSource(true);
      setFileName(file.name);
    } catch {
      if (mounted.current && request === pendingRead.current)
        setError(t('The file could not be read. Try again.', 'อ่านไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง'));
    } finally {
      if (mounted.current && request === pendingRead.current) setReading(false);
    }
  }

  function review() {
    const source = sourceInput.current?.value ?? '';
    if (!destination || !data.companies.some((company) => company.id === destination)) {
      setError(t('Choose a company first.', 'กรุณาเลือกบริษัทก่อน'));
      companyInput.current?.focus();
      return;
    }
    if (!source.trim()) {
      setError(
        t(
          'Paste group outerHTML or choose a file first.',
          'วาง outerHTML ของกลุ่มหรือเลือกไฟล์ก่อน',
        ),
      );
      return;
    }
    const request = ++pendingReview.current;
    setError('');
    setNotice('');
    setPreview(null);
    setPreviewRevision('');
    reviewedSource.current = '';
    setReviewing(true);
    // Let the progress state paint before parsing a large copied group list.
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (
          !mounted.current ||
          request !== pendingReview.current ||
          revision !== latestRevision.current
        )
          return;
        try {
          const result = previewGroupHtmlImport(source, data, destination);
          reviewedSource.current = source;
          setPreview(result);
          setPreviewRevision(revision);
          setChangeLimit(PREVIEW_BATCH);
          setIssueLimit(PREVIEW_BATCH);
        } catch (cause) {
          setError(
            cause instanceof Error
              ? messageText(cause.message, t)
              : t(
                  'This HTML could not be read. Check the source and try again.',
                  'อ่าน HTML ไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง',
                ),
          );
        } finally {
          if (request === pendingReview.current) setReviewing(false);
        }
      }, 0);
    });
  }

  async function apply() {
    if (
      !preview?.changes.length ||
      !reviewedSource.current ||
      previewRevision !== revision ||
      preview.companyId !== destination ||
      sourceInput.current?.value !== reviewedSource.current ||
      applyingNow.current
    )
      return;
    applyingNow.current = true;
    setApplying(true);
    setError('');
    try {
      await onApply(reviewedSource.current, destination, previewRevision);
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? messageText(cause.message, t)
            : t(
                'The groups could not be saved. Your pasted HTML is still here.',
                'บันทึกกลุ่มไม่สำเร็จ HTML ที่วางไว้ยังอยู่ที่นี่',
              ),
        );
    } finally {
      applyingNow.current = false;
      if (mounted.current) setApplying(false);
    }
  }

  const locked = reading || reviewing || applying;
  const additions = preview?.changes.filter((change) => change.kind === 'add').length ?? 0;
  const updates = preview?.changes.filter((change) => change.kind === 'update').length ?? 0;
  const formatter = new Intl.NumberFormat(t('en-US', 'th-TH'));

  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${s.dialog}`}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-intro`}
      onCancel={(event) => {
        event.preventDefault();
        if (!applyingNow.current) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled), select:not(:disabled), a[href]',
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
      }}
    >
      <header className={styles.header}>
        <div className={styles.headerIcon} aria-hidden="true">
          <Import size={23} />
        </div>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t('FACEBOOK GROUPS', 'กลุ่ม FACEBOOK')}</span>
          <h2 id={`${id}-title`}>{t('Import / update groups', 'นำเข้า / อัปเดตกลุ่ม')}</h2>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('Close group import dialog', 'ปิดหน้าต่างนำเข้ากลุ่ม')}
          onClick={onClose}
          disabled={applying}
        >
          <X size={20} />
        </button>
      </header>
      <div className={styles.body} aria-busy={locked}>
        <p id={`${id}-intro`} className={styles.intro}>
          {t(
            'Paste the outerHTML copied from Facebook’s joined-groups list. Choose a company, then review new groups and name updates before saving.',
            'วาง outerHTML ที่คัดลอกจากรายการกลุ่มที่คุณเข้าร่วมใน Facebook เลือกบริษัท แล้วตรวจสอบกลุ่มใหม่และชื่อกลุ่มที่จะอัปเดตก่อนบันทึก',
          )}
        </p>
        <label className={s.companyField}>
          {t('Company', 'บริษัท')}
          <select
            ref={companyInput}
            value={destination}
            disabled={locked}
            onChange={(event) => {
              setDestination(event.target.value);
              setError('');
              setNotice('');
              invalidatePreview();
            }}
          >
            <option value="">{t('Choose a company', 'เลือกบริษัท')}</option>
            {sortCatalog(data.companies).map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.sourcePanel}>
          <div className={styles.sourceTop}>
            <label htmlFor={`${id}-source`}>{t('Group outerHTML', 'outerHTML ของกลุ่ม')}</label>
            <span>
              {t('Paste HTML or choose a saved file', 'วาง HTML หรือเลือกไฟล์ที่บันทึกไว้')}
            </span>
          </div>
          <textarea
            id={`${id}-source`}
            ref={sourceInput}
            className={styles.textarea}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            disabled={locked}
            onChange={sourceChanged}
            placeholder={'<div ...><h2>...</h2><div role="list">...</div></div>'}
            aria-describedby={`${id}-source-help`}
          />
          <div className={styles.sourceActions}>
            <p id={`${id}-source-help`} className={styles.sourceHint}>
              {reading
                ? t('Reading file…', 'กำลังอ่านไฟล์…')
                : fileName || t('HTML / TXT · up to 10 MB', 'HTML / TXT · สูงสุด 10 MB')}
            </p>
            <div className={styles.sourceButtons}>
              <input
                ref={fileInput}
                type="file"
                className={styles.fileInput}
                accept=".html,.htm,.txt,text/html,text/plain"
                tabIndex={-1}
                aria-label={t('Choose group HTML file', 'เลือกไฟล์ HTML ของกลุ่ม')}
                disabled={locked}
                onChange={(event) => void chooseFile(event)}
              />
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={locked}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={17} />
                {t('Choose file', 'เลือกไฟล์')}
              </button>
              <button
                type="button"
                className={styles.previewButton}
                disabled={locked || !hasSource || !destination}
                onClick={review}
              >
                <ScanSearch size={17} />
                {t('Preview changes', 'ดูตัวอย่างการเปลี่ยนแปลง')}
              </button>
            </div>
          </div>
        </div>
        {error && (
          <div className={styles.error} role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className={styles.notice} role="status">
            <AlertCircle size={18} />
            <span>{notice}</span>
          </div>
        )}
        {reviewing && (
          <div className={styles.reviewing} role="status">
            <ScanSearch size={18} />
            <span>
              {t(
                'Reading groups and checking existing records…',
                'กำลังอ่านกลุ่มและตรวจสอบข้อมูลเดิม…',
              )}
            </span>
          </div>
        )}
        {preview && (
          <section className={styles.preview} aria-labelledby={`${id}-preview`}>
            <div className={styles.previewHeader}>
              <h3 id={`${id}-preview`} ref={previewTitle} tabIndex={-1}>
                {t('Review group changes', 'ตรวจสอบการเปลี่ยนแปลงกลุ่ม')}
              </h3>
              <span>
                {t(
                  `${formatter.format(preview.found)} groups found`,
                  `พบ ${formatter.format(preview.found)} กลุ่ม`,
                )}
              </span>
            </div>
            <div className={`${styles.summary} ${s.summary}`}>
              {[
                [additions, t('Add', 'เพิ่ม')],
                [updates, t('Update', 'อัปเดต')],
                [preview.unchanged, t('Unchanged', 'ไม่เปลี่ยนแปลง')],
                [preview.issues.length, t('Needs review', 'ต้องตรวจสอบ')],
              ].map(([count, label]) => (
                <div className={styles.summaryItem} key={label}>
                  <strong>{formatter.format(Number(count))}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <p className={s.preserved}>
              {t(
                'Matches use the Facebook group link within this company. Saved notes, categories and linked posts stay unchanged. Groups in Trash are skipped.',
                'จับคู่ด้วยลิงก์กลุ่ม Facebook ภายในบริษัทนี้ หมายเหตุ หมวดหมู่ และโพสต์ที่เชื่อมอยู่จะคงเดิม โดยข้ามกลุ่มในถังขยะ',
              )}
            </p>
            {preview.changes.length ? (
              <>
                <ul
                  className={s.rows}
                  aria-label={t('Groups ready to save', 'กลุ่มที่พร้อมบันทึก')}
                >
                  {preview.changes.slice(0, changeLimit).map((change) => (
                    <li className={s.row} key={`${change.kind}-${change.key}`}>
                      <span className={`${s.badge} ${change.kind === 'add' ? s.added : ''}`}>
                        {change.kind === 'add' ? t('Add', 'เพิ่ม') : t('Update', 'อัปเดต')}
                      </span>
                      <div className={s.details}>
                        {change.kind === 'update' && (
                          <span className={s.previous}>
                            {t('Current: ', 'เดิม: ')}
                            {change.previousName}
                          </span>
                        )}
                        <strong>
                          {change.kind === 'update' && t('New: ', 'ใหม่: ')}
                          {change.name}
                        </strong>
                        <a href={change.url} target="_blank" rel="noopener noreferrer">
                          <span>{change.url}</span>
                          <ExternalLink size={14} aria-hidden="true" />
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
                {preview.changes.length > changeLimit && (
                  <button
                    type="button"
                    className={styles.moreButton}
                    onClick={() => setChangeLimit((value) => value + PREVIEW_BATCH)}
                  >
                    {t('Show more groups', 'แสดงกลุ่มเพิ่มเติม')}
                  </button>
                )}
              </>
            ) : (
              <p className={styles.noChanges}>
                {t('No groups need to be added or updated.', 'ไม่มีกลุ่มที่ต้องเพิ่มหรืออัปเดต')}
              </p>
            )}
            {preview.issues.length > 0 && (
              <>
                <h4 className={styles.sectionHeading}>
                  <AlertCircle size={18} />
                  {t('Needs review — skipped', 'ต้องตรวจสอบ — ข้ามรายการเหล่านี้')}
                </h4>
                <ul className={s.rows}>
                  {preview.issues.slice(0, issueLimit).map((issue, index) => (
                    <li className={`${s.row} ${s.issue}`} key={`${issue.key}-${index}`}>
                      <div className={s.details}>
                        {(issue.name || issue.key) && <strong>{issue.name || issue.key}</strong>}
                        <p>{messageText(issue.reason, t)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                {preview.issues.length > issueLimit && (
                  <button
                    type="button"
                    className={styles.moreButton}
                    onClick={() => setIssueLimit((value) => value + PREVIEW_BATCH)}
                  >
                    {t('Show more issues', 'แสดงรายการที่ต้องตรวจสอบเพิ่มเติม')}
                  </button>
                )}
              </>
            )}
          </section>
        )}
      </div>
      <footer className={styles.footer}>
        <span className={styles.footerNote}>
          {t('Only reviewed changes will be saved.', 'บันทึกเฉพาะการเปลี่ยนแปลงที่ตรวจสอบแล้ว')}
        </span>
        <button type="button" className={styles.cancelButton} onClick={onClose} disabled={applying}>
          {t('Cancel', 'ยกเลิก')}
        </button>
        <button
          type="button"
          className={styles.applyButton}
          disabled={locked || !preview?.changes.length || previewRevision !== revision}
          onClick={() => void apply()}
        >
          <Check size={17} />
          {applying ? t('Saving…', 'กำลังบันทึก…') : t('Apply changes', 'บันทึกการเปลี่ยนแปลง')}
        </button>
      </footer>
    </dialog>
  );
}
