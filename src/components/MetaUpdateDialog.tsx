'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AlertCircle, ArrowRight, Check, Eye, ScanSearch, Upload, X } from 'lucide-react';
import { reportingDate } from '@/lib/data';
import { formatCalendarDate } from '@/lib/calendar';
import type { Translate, Workspace } from '@/lib/types';
import {
  previewMetaViewersUpdate,
  type MetaUpdateIssue,
  type MetaUpdateOptions,
  type MetaUpdatePreview,
} from '@/lib/meta-viewers-import';
import styles from './MetaUpdateDialog.module.css';
import CalendarField from './CalendarField';

type Props = {
  data: Workspace;
  revision: string;
  t: Translate;
  onApply: (source: string, previewRevision: string, options: MetaUpdateOptions) => Promise<void>;
  onClose: () => void;
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PREVIEW_BATCH = 60;

function issueKind(issue: MetaUpdateIssue, t: Translate) {
  switch (issue.kind) {
    case 'ambiguous':
      return t('Ambiguous', 'จับคู่ไม่แน่ชัด');
    case 'duplicate':
      return t('Duplicate', 'ข้อมูลซ้ำ');
    case 'invalid':
      return t('Invalid', 'ข้อมูลไม่ถูกต้อง');
    default:
      return t('Unmatched', 'ไม่พบโพสต์');
  }
}

function issueReason(issue: MetaUpdateIssue, t: Translate) {
  const known: Record<string, string> = {
    'Viewers cell is missing or not an exact whole number.':
      'ช่องผู้ชมหายไปหรือไม่ใช่จำนวนเต็มที่แน่นอน',
    'No tracked post matches this row.': 'ไม่พบโพสต์ที่ติดตามซึ่งตรงกับแถวนี้',
    'More than one tracked post matches this row.': 'มีหลายโพสต์ที่อาจตรงกับแถวนี้',
    'More than one source row matches this post.': 'มีหลายแถวในข้อมูลต้นฉบับที่ตรงกับโพสต์นี้',
    'Published date conflicts with the saved date.': 'วันที่เผยแพร่ไม่ตรงกับวันที่ที่บันทึกไว้',
    'Source Viewers total is lower than the saved total.':
      'ยอดผู้ชมจากต้นฉบับน้อยกว่ายอดที่บันทึกไว้',
    'Publication year conflicts with the year in the source row.':
      'ปีเผยแพร่ไม่ตรงกับปีในข้อมูลต้นฉบับ',
    'Publication date is not a valid calendar date.':
      'วันที่เผยแพร่ไม่ใช่วันที่ตามปฏิทินที่ถูกต้อง',
    'Publication date is in the future.': 'วันที่เผยแพร่อยู่ในอนาคต',
    'More than one Facebook group post link appears in this row.':
      'แถวนี้มีลิงก์โพสต์ในกลุ่ม Facebook มากกว่าหนึ่งลิงก์',
    'The Meta Viewers column could not be identified.': 'ไม่พบคอลัมน์ผู้ชมของ Meta',
    'Relative date has no post link or capture date. Enter the Meta table capture date or assign a post link to this row.':
      'แถววันที่แบบสัมพัทธ์ไม่มีลิงก์โพสต์หรือวันที่คัดลอกตาราง กรุณาระบุวันที่คัดลอกตาราง Meta หรือกำหนดลิงก์โพสต์ให้แถวนี้',
    'Publication date is after the Meta table capture date.':
      'วันที่เผยแพร่อยู่หลังวันที่คัดลอกตาราง Meta',
    'The assigned post link conflicts with a link in the Meta row.':
      'ลิงก์โพสต์ที่กำหนดขัดแย้งกับลิงก์ในแถวข้อมูล Meta',
    'The assigned post belongs to a different known Facebook group.':
      'โพสต์ที่กำหนดอยู่คนละกลุ่ม Facebook กับแถวข้อมูลนี้',
  };
  return t(issue.reason, known[issue.reason] ?? issue.reason);
}

function warningText(warning: string, t: Translate) {
  const known: Record<string, string> = {
    'The source has no publication year; unknown dates will remain blank unless you enter one.':
      'ข้อมูลต้นฉบับไม่มีปีเผยแพร่ วันที่ที่ยังไม่ทราบจะเว้นว่างไว้จนกว่าจะระบุปี',
    'Relative dates such as “today” need the Meta table capture date or exact post links to update Viewers.':
      'แถววันที่แบบ “วันนี้” ต้องระบุวันที่คัดลอกตาราง Meta หรือลิงก์โพสต์ที่ตรงกันเพื่ออัปเดตผู้ชม',
  };
  return t(warning, known[warning] ?? warning);
}

function parserErrorText(message: string, t: Translate) {
  const missingRow = /^Source row (.+) does not exist\.$/.exec(message);
  if (missingRow) return t(message, `ไม่พบแถวที่ ${missingRow[1]} ในตารางต้นฉบับ`);
  const invalidRowLink = /^Source row (\d+) needs an exact Facebook group post URL\.$/.exec(
    message,
  );
  if (invalidRowLink)
    return t(message, `แถวที่ ${invalidRowLink[1]} ต้องใช้ลิงก์โพสต์ในกลุ่ม Facebook ที่ถูกต้อง`);
  const known: Record<string, string> = {
    'Meta table is too large (10 MB maximum).': 'ตาราง Meta ใหญ่เกินไป (สูงสุด 10 MB)',
    'Publication year must be a four-digit Gregorian year.': 'ปีเผยแพร่ต้องเป็นปี ค.ศ. 4 หลัก',
    'No Meta table rows were found. Paste the table HTML.':
      'ไม่พบแถวข้อมูลของตาราง Meta กรุณาวาง HTML ของตาราง',
    'Meta table has too many rows (2,000 maximum).': 'ตาราง Meta มีแถวมากเกินไป (สูงสุด 2,000 แถว)',
    'Row post links must be keyed by one-based source row numbers.':
      'ลิงก์โพสต์ต้องระบุด้วยหมายเลขแถวของตารางต้นฉบับ เริ่มนับจาก 1',
    'Meta table capture date must be a valid YYYY-MM-DD date in Thailand time.':
      'วันที่คัดลอกตาราง Meta ต้องเป็นวันที่ถูกต้องในรูปแบบ YYYY-MM-DD ตามเวลาประเทศไทย',
    'Meta table capture date cannot be in the future.': 'วันที่คัดลอกตาราง Meta ต้องไม่อยู่ในอนาคต',
  };
  return t(message, known[message] ?? message);
}

export default function MetaUpdateDialog({ data, revision, t, onApply, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sourceInput = useRef<HTMLTextAreaElement>(null);
  const previewTitle = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingRead = useRef(0);
  const pendingReview = useRef(0);
  const mounted = useRef(true);
  const previousRevision = useRef(revision);
  const reviewedSource = useRef('');
  const [hasSource, setHasSource] = useState(false);
  const [fileName, setFileName] = useState('');
  const [year, setYear] = useState('');
  const [capturedOn, setCapturedOn] = useState(() => reportingDate(new Date()));
  const [captureDateManual, setCaptureDateManual] = useState(false);
  const [rowPostLinks, setRowPostLinks] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<MetaUpdatePreview | null>(null);
  const [previewRevision, setPreviewRevision] = useState('');
  const [previewOptions, setPreviewOptions] = useState<MetaUpdateOptions | null>(null);
  const [changeLimit, setChangeLimit] = useState(PREVIEW_BATCH);
  const [issueLimit, setIssueLimit] = useState(PREVIEW_BATCH);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reading, setReading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [applying, setApplying] = useState(false);

  const numberFormatter = useMemo(() => new Intl.NumberFormat(t('en-US', 'th-TH')), [t]);
  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: 'Asia/Bangkok',
      }),
    [],
  );
  const postById = useMemo(() => new Map(data.posts.map((post) => [post.id, post])), [data]);

  useLayoutEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (element && !element.open) element.showModal();
    sourceInput.current?.focus();
    return () => {
      mounted.current = false;
      pendingRead.current += 1;
      pendingReview.current += 1;
      element?.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);

  // An outside edit invalidates this preview. The save path independently checks the revision.
  useEffect(() => {
    if (revision === previousRevision.current) return;
    previousRevision.current = revision;
    invalidatePreview();
    setNotice(
      t(
        'The workspace changed. Review the source again before applying updates.',
        'ข้อมูลในพื้นที่ทำงานเปลี่ยนไป กรุณาตรวจสอบข้อมูลอีกครั้งก่อนอัปเดต',
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
    setPreviewOptions(null);
    setReviewing(false);
    setChangeLimit(PREVIEW_BATCH);
    setIssueLimit(PREVIEW_BATCH);
  }

  function sourceChanged() {
    setHasSource(Boolean(sourceInput.current?.value.length));
    setFileName('');
    setCapturedOn(reportingDate(new Date()));
    setCaptureDateManual(false);
    setRowPostLinks({});
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
    setCapturedOn(reportingDate(new Date()));
    setCaptureDateManual(false);
    setRowPostLinks({});
    invalidatePreview();
    if (!/\.(html?|txt)$/i.test(file.name)) {
      setError(t('Choose an HTML or text file.', 'เลือกไฟล์ HTML หรือไฟล์ข้อความ'));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(t('Choose a file smaller than 10 MB.', 'เลือกไฟล์ที่มีขนาดเล็กกว่า 10 MB'));
      return;
    }
    setReading(true);
    try {
      const content = await file.text();
      if (request !== pendingRead.current) return;
      if (!content.trim()) {
        setError(t('The selected file is empty.', 'ไฟล์ที่เลือกไม่มีข้อมูล'));
        return;
      }
      if (sourceInput.current) sourceInput.current.value = content;
      setHasSource(true);
      setFileName(file.name);
    } catch {
      if (request === pendingRead.current)
        setError(t('The file could not be read. Try again.', 'อ่านไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง'));
    } finally {
      if (request === pendingRead.current) setReading(false);
    }
  }

  function updateRowPostLink(row: number, value: string) {
    setRowPostLinks((current) => {
      const next = { ...current };
      if (value) next[row] = value;
      else delete next[row];
      return next;
    });
    reviewedSource.current = '';
    setPreviewRevision('');
    setPreviewOptions(null);
    setError('');
    setNotice(
      t(
        'Post links changed. Preview the table again before saving.',
        'ลิงก์โพสต์เปลี่ยนแล้ว กรุณาดูตัวอย่างตารางอีกครั้งก่อนบันทึก',
      ),
    );
  }

  function review() {
    const source = sourceInput.current?.value ?? '';
    if (!source.trim()) {
      setError(t('Paste a Meta table or choose a file first.', 'วางตาราง Meta หรือเลือกไฟล์ก่อน'));
      return;
    }
    const yearText = year.trim();
    if (yearText && !/^[1-9]\d{3}$/.test(yearText)) {
      setError(
        t(
          'Use a four-digit publication year, such as 2026, or leave it blank.',
          'ระบุปีเผยแพร่ ค.ศ. 4 หลัก เช่น 2026 หรือเว้นว่างไว้',
        ),
      );
      return;
    }
    const publicationYear = yearText ? Number(yearText) : undefined;
    const tableDate = captureDateManual ? capturedOn : reportingDate(new Date());
    if (!captureDateManual) setCapturedOn(tableDate);
    const options: MetaUpdateOptions = {
      publicationYear,
      capturedOn: tableDate || null,
      rowPostLinks: { ...rowPostLinks },
    };
    const request = ++pendingReview.current;
    setError('');
    setNotice('');
    setPreview(null);
    setPreviewRevision('');
    setReviewing(true);

    // Yield a frame so the analyzing state paints before a large pasted table is parsed.
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (request !== pendingReview.current) return;
        try {
          const result = previewMetaViewersUpdate(source, data, options);
          if (request !== pendingReview.current) return;
          reviewedSource.current = source;
          setPreview(result);
          setPreviewRevision(revision);
          setPreviewOptions(options);
          setChangeLimit(PREVIEW_BATCH);
          setIssueLimit(PREVIEW_BATCH);
        } catch (cause) {
          if (request !== pendingReview.current) return;
          setError(
            cause instanceof Error
              ? parserErrorText(cause.message, t)
              : t(
                  'This Meta table could not be read. Check the source and try again.',
                  'อ่านตาราง Meta ไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง',
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
      !previewRevision ||
      !previewOptions ||
      applying
    )
      return;
    setApplying(true);
    setError('');
    try {
      await onApply(reviewedSource.current, previewRevision, previewOptions);
      if (mounted.current) invalidatePreview();
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : t(
                'Updates could not be saved. Your posts are unchanged.',
                'บันทึกการอัปเดตไม่สำเร็จ โพสต์ของคุณยังคงเดิม',
              ),
        );
    } finally {
      if (mounted.current) setApplying(false);
    }
  }

  const formatCount = (value: number | null) =>
    value === null ? '—' : numberFormatter.format(value);
  const formatDate = (value: string) => {
    if (!value) return 'Null';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value
      : `${formatCalendarDate(reportingDate(parsed))} ${timeFormatter.format(parsed)}`;
  };
  const locked = reading || reviewing || applying;

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="meta-update-title"
      aria-describedby="meta-update-intro"
      onCancel={(event) => {
        event.preventDefault();
        if (!applying) onClose();
      }}
    >
      <header className={styles.header}>
        <div className={styles.headerIcon} aria-hidden="true">
          <Eye size={23} />
        </div>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>{t('POST PERFORMANCE', 'ผลลัพธ์ของโพสต์')}</span>
          <h2 id="meta-update-title">{t('Update metrics from Meta', 'อัปเดตสถิติจาก Meta')}</h2>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('Close update dialog', 'ปิดหน้าต่างอัปเดต')}
          onClick={onClose}
          disabled={applying}
        >
          <X size={20} />
        </button>
      </header>

      <div className={styles.body}>
        <p id="meta-update-intro" className={styles.intro}>
          {t(
            'Paste a Meta posts table to match existing posts. “Today” and “yesterday” use the current Bangkok date automatically. Review every change before saving.',
            'วางตารางโพสต์จาก Meta เพื่อจับคู่กับโพสต์เดิม ระบบใช้วันที่ปัจจุบันตามเวลาประเทศไทยกับแถว “วันนี้” และ “เมื่อวานนี้” โดยอัตโนมัติ ตรวจสอบทุกการเปลี่ยนแปลงก่อนบันทึก',
          )}
        </p>

        <div className={styles.sourcePanel}>
          <div className={styles.sourceTop}>
            <label htmlFor="meta-source">{t('Meta table HTML', 'HTML ตารางจาก Meta')}</label>
            <span>
              {t('Paste the table or choose a saved file', 'วางตารางหรือเลือกไฟล์ที่บันทึกไว้')}
            </span>
          </div>
          <textarea
            id="meta-source"
            ref={sourceInput}
            className={styles.textarea}
            placeholder={t(
              'Paste the <tbody> or full HTML table here…',
              'วาง <tbody> หรือตาราง HTML ทั้งหมดที่นี่…',
            )}
            spellCheck={false}
            onInput={sourceChanged}
            disabled={locked}
          />
          <div className={styles.yearRow}>
            <label htmlFor="meta-publication-year">
              {t('Publication year', 'ปีที่เผยแพร่')} <span>{t('(optional)', '(ไม่บังคับ)')}</span>
            </label>
            <input
              id="meta-publication-year"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              value={year}
              placeholder="2026"
              onChange={(event) => {
                setYear(event.target.value);
                setError('');
                setNotice('');
                invalidatePreview();
              }}
              disabled={locked}
            />
            <p>
              {t(
                'For dated rows where Meta omits the year. “Today” and “yesterday” use the date below.',
                'สำหรับแถวที่มีวันที่แต่ Meta ไม่แสดงปี ส่วน “วันนี้” และ “เมื่อวานนี้” จะใช้วันที่ด้านล่าง',
              )}
            </p>
          </div>
          <div className={`${styles.yearRow} ${styles.captureRow}`}>
            <CalendarField
              label={t('Date Meta table was copied', 'วันที่คัดลอกตาราง Meta')}
              t={t}
              min="1900-01-01"
              max={reportingDate(new Date().toISOString())}
              value={capturedOn}
              onChange={(value) => {
                setCapturedOn(value);
                setCaptureDateManual(true);
                setError('');
                setNotice('');
                invalidatePreview();
              }}
              disabled={locked}
              describedBy="meta-capture-help"
            />
            <p id="meta-capture-help">
              {t(
                'Today’s Bangkok date is filled automatically. Change it for an older table. If its date is unknown, clear this field and match relative rows with exact post URLs.',
                'ระบบใส่วันที่ปัจจุบันตามเวลาประเทศไทยให้อัตโนมัติ หากเป็นตารางเก่าให้เปลี่ยนวันที่ หากไม่ทราบวันที่ให้ล้างช่องนี้และจับคู่แถววันที่สัมพัทธ์ด้วยลิงก์โพสต์ที่ตรงกัน',
              )}
            </p>
          </div>
          {Object.entries(rowPostLinks).length > 0 && (
            <div className={styles.assignedLinks}>
              <strong>{t('Assigned source rows', 'แถวที่กำหนดลิงก์โพสต์')}</strong>
              {Object.entries(rowPostLinks)
                .sort(([first], [second]) => Number(first) - Number(second))
                .map(([row, link]) => (
                  <div key={row}>
                    <label htmlFor={`meta-assigned-row-${row}`}>
                      {t('Row', 'แถวที่')} {row}
                    </label>
                    <input
                      id={`meta-assigned-row-${row}`}
                      type="url"
                      value={link}
                      onChange={(event) => updateRowPostLink(Number(row), event.target.value)}
                      disabled={locked}
                      aria-label={t(
                        `Facebook post URL for source row ${row}`,
                        `ลิงก์โพสต์ Facebook สำหรับแถวที่ ${row}`,
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => updateRowPostLink(Number(row), '')}
                      disabled={locked}
                      aria-label={t(
                        `Remove post link for row ${row}`,
                        `ลบลิงก์โพสต์ของแถวที่ ${row}`,
                      )}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                ))}
            </div>
          )}
          <div className={styles.sourceActions}>
            <p className={styles.sourceHint}>
              {fileName || t('HTML or TXT · up to 10 MB', 'ไฟล์ HTML หรือ TXT · สูงสุด 10 MB')}
            </p>
            <div className={styles.sourceButtons}>
              <input
                ref={fileInput}
                className={styles.fileInput}
                type="file"
                accept=".html,.htm,.txt,text/html,text/plain"
                onChange={chooseFile}
                aria-label={t('Choose Meta table file', 'เลือกไฟล์ตาราง Meta')}
                disabled={locked}
              />
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => fileInput.current?.click()}
                disabled={locked}
              >
                <Upload size={17} />
                {t('Choose file', 'เลือกไฟล์')}
              </button>
              <button
                type="button"
                className={styles.previewButton}
                onClick={review}
                disabled={!hasSource || locked}
              >
                <ScanSearch size={17} />
                {t('Preview updates', 'ดูตัวอย่างการอัปเดต')}
              </button>
            </div>
          </div>
        </div>

        {notice && (
          <div className={styles.notice} role="status">
            <AlertCircle size={18} />
            <span>{notice}</span>
          </div>
        )}
        {reading && (
          <div className={styles.reviewing} role="status" aria-live="polite">
            <Upload size={18} />
            <span>{t('Reading the selected file…', 'กำลังอ่านไฟล์ที่เลือก…')}</span>
          </div>
        )}
        {error && (
          <div className={styles.error} role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}
        {reviewing && (
          <div className={styles.reviewing} role="status" aria-live="polite">
            <ScanSearch size={18} />
            <span>
              {t('Matching posts and checking changes…', 'กำลังจับคู่โพสต์และตรวจสอบข้อมูล…')}
            </span>
          </div>
        )}

        {preview && (
          <section className={styles.preview} aria-labelledby="meta-preview-title">
            <div className={styles.previewHeader}>
              <h3 id="meta-preview-title" ref={previewTitle} tabIndex={-1}>
                {t('Review changes', 'ตรวจสอบการเปลี่ยนแปลง')}
              </h3>
              <span>
                {t(`${preview.sourceRows} source rows`, `${preview.sourceRows} แถวจากต้นฉบับ`)}
              </span>
            </div>
            <div className={styles.summary}>
              <div className={`${styles.summaryItem} ${styles.summaryItemReady}`}>
                <strong>{numberFormatter.format(preview.changes.length)}</strong>
                <span>{t('ready to update', 'พร้อมอัปเดต')}</span>
              </div>
              <div className={styles.summaryItem}>
                <strong>{numberFormatter.format(preview.unchanged.length)}</strong>
                <span>{t('already current', 'ข้อมูลตรงอยู่แล้ว')}</span>
              </div>
              <div className={styles.summaryItem}>
                <strong>{numberFormatter.format(preview.issues.length)}</strong>
                <span>{t('need attention', 'ต้องตรวจสอบ')}</span>
              </div>
            </div>

            {preview.warnings.map((warning, index) => (
              <div className={styles.notice} key={`${index}-${warning}`} role="status">
                <AlertCircle size={18} />
                <span>{warningText(warning, t)}</span>
              </div>
            ))}

            {preview.changes.length > 0 ? (
              <>
                <h4 className={styles.sectionHeading}>
                  <Check size={18} />
                  {t('Matched changes', 'รายการที่จับคู่และเปลี่ยนแปลง')}
                </h4>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">{t('Post', 'โพสต์')}</th>
                        <th scope="col">{t('Viewers', 'ผู้ชม')}</th>
                        <th scope="col">{t('Comments', 'ความคิดเห็น')}</th>
                        <th scope="col">{t('Published', 'วันที่เผยแพร่')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.changes.slice(0, changeLimit).map((change) => {
                        const post = postById.get(change.postId);
                        const viewersChanged = change.oldViewers !== change.newViewers;
                        const commentsChanged =
                          change.newCommentCount !== undefined &&
                          change.oldCommentCount !== change.newCommentCount;
                        const dateChanged = change.oldPublishedAt !== change.newPublishedAt;
                        return (
                          <tr key={`${change.row}-${change.postId}`}>
                            <td>
                              <strong className={styles.postName} title={change.label}>
                                {change.label ||
                                  post?.product ||
                                  t('Published post', 'โพสต์ที่เผยแพร่แล้ว')}
                              </strong>
                              <span className={styles.postDetail}>
                                {t('Row', 'แถวที่')} {change.row}
                                {post?.facebookPostId ? ` · ${post.facebookPostId}` : ''}
                              </span>
                            </td>
                            <td>
                              {viewersChanged ? (
                                <span className={styles.valueChange}>
                                  <span className={styles.oldValue}>
                                    {formatCount(change.oldViewers)}
                                  </span>
                                  <ArrowRight size={15} aria-hidden="true" />
                                  <span className={styles.newValue}>
                                    {formatCount(change.newViewers)}
                                  </span>
                                </span>
                              ) : (
                                <span className={styles.unchangedValue}>
                                  {formatCount(change.newViewers)}
                                </span>
                              )}
                            </td>
                            <td>
                              {change.newCommentCount === undefined ? (
                                <span
                                  className={styles.unchangedValue}
                                  title={t(
                                    'No exact Comments count in this source row; the saved count stays unchanged.',
                                    'แถวข้อมูลนี้ไม่มีจำนวนความคิดเห็นที่แน่นอน จำนวนที่บันทึกไว้จะไม่เปลี่ยน',
                                  )}
                                >
                                  {formatCount(change.oldCommentCount)} ·{' '}
                                  {t('not in source', 'ไม่มีในข้อมูลต้นฉบับ')}
                                </span>
                              ) : commentsChanged ? (
                                <span className={styles.valueChange}>
                                  <span className={styles.oldValue}>
                                    {formatCount(change.oldCommentCount)}
                                  </span>
                                  <ArrowRight size={15} aria-hidden="true" />
                                  <span className={styles.newValue}>
                                    {formatCount(change.newCommentCount ?? null)}
                                  </span>
                                </span>
                              ) : (
                                <span className={styles.unchangedValue}>
                                  {formatCount(change.newCommentCount)}
                                </span>
                              )}
                            </td>
                            <td>
                              {dateChanged ? (
                                <span className={styles.valueChange}>
                                  <span className={styles.oldValue}>
                                    {formatDate(change.oldPublishedAt)}
                                  </span>
                                  <ArrowRight size={15} aria-hidden="true" />
                                  <span className={styles.newValue}>
                                    {formatDate(change.newPublishedAt)}
                                  </span>
                                </span>
                              ) : (
                                <span className={styles.unchangedValue}>
                                  {formatDate(change.newPublishedAt)}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {changeLimit < preview.changes.length && (
                  <button
                    type="button"
                    className={styles.moreButton}
                    onClick={() => setChangeLimit((count) => count + PREVIEW_BATCH)}
                  >
                    {t('Show more matched posts', 'แสดงโพสต์ที่จับคู่เพิ่มเติม')}
                  </button>
                )}
              </>
            ) : (
              <div className={styles.noChanges}>
                {t(
                  'No safe changes to save from this table. Check the source and any rows below.',
                  'ไม่มีข้อมูลที่เปลี่ยนแปลงและบันทึกได้อย่างปลอดภัย กรุณาตรวจสอบต้นฉบับและรายการด้านล่าง',
                )}
              </div>
            )}

            {preview.issues.length > 0 && (
              <div className={styles.issues}>
                <h4>
                  <AlertCircle size={18} />
                  {t('Rows needing attention', 'แถวที่ต้องตรวจสอบ')}
                </h4>
                <p>
                  {t(
                    'These rows are skipped. For “today” or “yesterday,” check the capture date above. You can also assign an exact URL after verifying the Meta row against that post, then preview again. Add posts missing from your library first.',
                    'แถวเหล่านี้จะถูกข้าม สำหรับ “วันนี้” หรือ “เมื่อวานนี้” ให้ตรวจสอบวันที่คัดลอกตารางด้านบน หรือกำหนดลิงก์ที่ตรงกันหลังตรวจสอบแถว Meta กับโพสต์นั้น แล้วดูตัวอย่างอีกครั้ง หากโพสต์ยังไม่อยู่ในคลัง ให้เพิ่มโพสต์ก่อน',
                  )}
                </p>
                <ul className={styles.issueList}>
                  {preview.issues.slice(0, issueLimit).map((issue, index) => (
                    <li key={`${issue.row}-${issue.kind}-${index}`}>
                      <span className={styles.issueLabel}>
                        {t('Row', 'แถวที่')} {issue.row}
                      </span>
                      <div className={styles.issueContent}>
                        <span>
                          <strong>{issueKind(issue, t)}</strong>
                          {issue.label ? ` · ${issue.label}` : ''}
                          {issue.viewers !== null
                            ? ` · ${t('Viewers', 'ผู้ชม')} ${numberFormatter.format(issue.viewers)}`
                            : ''}
                          {issue.commentCount !== null
                            ? ` · ${t('Comments', 'ความคิดเห็น')} ${numberFormatter.format(issue.commentCount)}`
                            : ''}
                          {issue.reason ? ` — ${issueReason(issue, t)}` : ''}
                        </span>
                        {(issue.kind === 'unmatched' ||
                          issue.kind === 'ambiguous' ||
                          issue.reason.startsWith('Relative date')) && (
                          <label className={styles.rowLinkInput}>
                            <span>
                              {t(
                                `Facebook post URL for row ${issue.row}`,
                                `ลิงก์โพสต์ Facebook สำหรับแถวที่ ${issue.row}`,
                              )}
                            </span>
                            <input
                              type="url"
                              placeholder="https://www.facebook.com/groups/…/posts/…"
                              value={rowPostLinks[issue.row] ?? ''}
                              onChange={(event) => updateRowPostLink(issue.row, event.target.value)}
                              disabled={locked}
                            />
                          </label>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {Object.keys(rowPostLinks).length > 0 && (
                  <button
                    type="button"
                    className={styles.moreButton}
                    onClick={review}
                    disabled={locked}
                  >
                    <ScanSearch size={16} aria-hidden="true" />
                    {t('Preview with assigned links', 'ดูตัวอย่างด้วยลิงก์ที่กำหนด')}
                  </button>
                )}
                {issueLimit < preview.issues.length && (
                  <button
                    type="button"
                    className={styles.moreButton}
                    onClick={() => setIssueLimit((count) => count + PREVIEW_BATCH)}
                  >
                    {t('Show more rows', 'แสดงแถวเพิ่มเติม')}
                  </button>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      <footer className={styles.footer}>
        <span className={styles.footerNote}>
          {t('Only reviewed changes are saved.', 'บันทึกเฉพาะรายการที่ตรวจสอบแล้ว')}
        </span>
        <button type="button" className={styles.cancelButton} onClick={onClose} disabled={applying}>
          {t('Cancel', 'ยกเลิก')}
        </button>
        <button
          type="button"
          className={styles.applyButton}
          onClick={apply}
          disabled={!preview?.changes.length || !previewRevision || locked}
        >
          <Check size={18} />
          {applying
            ? t('Saving…', 'กำลังบันทึก…')
            : preview?.changes.length
              ? t(
                  `Update ${preview.changes.length} ${preview.changes.length === 1 ? 'post' : 'posts'}`,
                  `อัปเดต ${preview.changes.length} โพสต์`,
                )
              : t('Update posts', 'อัปเดตโพสต์')}
        </button>
      </footer>
    </dialog>
  );
}
