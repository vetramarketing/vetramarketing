'use client';

import { sortCatalog } from '@/lib/catalog';

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  Check,
  FileSpreadsheet,
  Upload,
  X,
} from 'lucide-react';
import type { Translate, Workspace } from '@/lib/types';
import { previewPostsCsv } from '@/lib/csv';
import { reportingDate } from '@/lib/data';
import { formatCalendarDate } from '@/lib/calendar';
import SelectionField from './SelectionField';
import styles from './ImportDialog.module.css';

type Props = {
  data: Workspace;
  revision: string;
  companyId: string;
  t: Translate;
  onImport: (source: string, destination: string, previewRevision: string) => Promise<void>;
  onClose: () => void;
};
type Preview = ReturnType<typeof previewPostsCsv>;

function issueText(issue: string, t: Translate): string {
  const row = /^Row (\d+): (.*)$/.exec(issue);
  if (row) return `${t('Row', 'แถวที่')} ${row[1]}: ${issueText(row[2], t)}`;
  const translations: Record<string, string> = {
    'The CSV is too large. Import files smaller than 10 MB.':
      'ไฟล์ CSV ใหญ่เกินไป กรุณาเลือกไฟล์ที่เล็กกว่า 10 MB',
    'The CSV contains too many columns.': 'ไฟล์ CSV มีคอลัมน์มากเกินไป',
    'Import at most 50,000 rows at a time.': 'นำเข้าได้ครั้งละไม่เกิน 50,000 แถว',
    'The CSV has an unclosed quoted field.': 'มีข้อความใน CSV ที่ยังไม่ได้ปิดเครื่องหมายอัญประกาศ',
    'Choose a company before importing.': 'เลือกบริษัทก่อนนำเข้า',
    'Unable to read this CSV.': 'อ่านไฟล์ CSV นี้ไม่สำเร็จ',
    'The CSV needs a header and at least one data row.':
      'ไฟล์ CSV ต้องมีหัวคอลัมน์และข้อมูลอย่างน้อยหนึ่งแถว',
    'No supported columns found. Include Product, Facebook group, Post ID, or Complete URL (auto).':
      'ไม่พบคอลัมน์ที่รองรับ กรุณาเพิ่ม Product, Facebook group, Post ID หรือ Complete URL (auto)',
    'This row has more fields than the header. Quote text containing commas.':
      'แถวนี้มีช่องข้อมูลมากกว่าหัวคอลัมน์ กรุณาใส่อัญประกาศครอบข้อความที่มีจุลภาค',
    'Post URL must be a valid HTTPS link.': 'URL ของโพสต์ต้องเป็นลิงก์ HTTPS ที่ถูกต้อง',
    'Published at is required.': 'ต้องระบุวันที่เผยแพร่จริง',
    'Published at cannot be in the future.': 'วันที่เผยแพร่ต้องไม่อยู่ในอนาคต',
    'Add a valid HTTPS post URL or both Facebook Group ID and Post ID.':
      'เพิ่ม URL โพสต์แบบ HTTPS ที่ถูกต้อง หรือระบุทั้ง Facebook Group ID และ Post ID',
    'Group ID must contain digits only. Format ID columns as text; scientific notation cannot be recovered.':
      'Group ID ต้องมีเฉพาะตัวเลข ตั้งค่าคอลัมน์ ID เป็นข้อความ ระบบไม่สามารถกู้คืนตัวเลขจากรูปแบบวิทยาศาสตร์ได้',
    'Post ID must contain digits only. Format ID columns as text; scientific notation cannot be recovered.':
      'Post ID ต้องมีเฉพาะตัวเลข ตั้งค่าคอลัมน์ ID เป็นข้อความ ระบบไม่สามารถกู้คืนตัวเลขจากรูปแบบวิทยาศาสตร์ได้',
    'The Facebook IDs do not match the post URL.': 'Facebook ID ไม่ตรงกับ URL ของโพสต์',
    'This group is in Trash. Restore it before importing posts.':
      'กลุ่มนี้อยู่ในถังขยะ กรุณากู้คืนก่อนนำเข้าโพสต์',
    'This group has a different or missing Facebook ID. Update the group first.':
      'Facebook ID ของกลุ่มนี้ไม่ตรงกันหรือยังไม่ได้ระบุ กรุณาแก้ไขกลุ่มก่อน',
    'Platform must be facebook, instagram, tiktok, or linkedin.':
      'แพลตฟอร์มต้องเป็น facebook, instagram, tiktok หรือ linkedin',
    'Metrics JSON could not be read.': 'อ่านข้อมูล Metrics JSON ไม่สำเร็จ',
    'Viewers must be a non-negative whole number.': 'จำนวนผู้ชมต้องเป็นจำนวนเต็มตั้งแต่ศูนย์ขึ้นไป',
    'Viewers is too large to company accurately.':
      'จำนวนผู้ชมมากเกินขอบเขตที่ระบบจะเก็บได้อย่างแม่นยำ',
    'The workspace limit is 50,000 posts.': 'พื้นที่ทำงานรองรับได้สูงสุด 50,000 โพสต์',
    'The workspace limit is 10,000 groups.': 'พื้นที่ทำงานรองรับได้สูงสุด 10,000 กลุ่ม',
    'Invalid data.': 'ข้อมูลไม่ถูกต้อง',
  };
  if (translations[issue]) return t(issue, translations[issue]);
  const invalidDate = /^(.*) is not a valid date\. Use YYYY-MM-DD or DD\/MM\/YYYY\.$/.exec(issue);
  if (invalidDate) {
    const field = invalidDate[1] === 'Published at' ? 'วันที่เผยแพร่' : invalidDate[1];
    return t(issue, `วันที่ในช่อง ${field} ไม่ถูกต้อง ใช้รูปแบบ YYYY-MM-DD หรือ DD/MM/YYYY`);
  }
  const quoteRow = /^Unexpected (quote|text after a closing quote) near CSV row (\d+)\.$/.exec(
    issue,
  );
  if (quoteRow)
    return t(issue, `เครื่องหมายอัญประกาศหรือข้อความไม่ถูกต้องใกล้แถวที่ ${quoteRow[2]}`);
  return issue;
}

export default function ImportDialog({ data, revision, companyId, t, onImport, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingRead = useRef(0);
  const [selectedCompany, setSelectedCompany] = useState(
    companyId !== 'all' && data.companies.some((item) => item.id === companyId)
      ? companyId
      : (sortCatalog(data.companies)[0]?.id ?? ''),
  );
  const [source, setSource] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewRevision, setPreviewRevision] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);

  useLayoutEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (element && !element.open) element.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
      pendingRead.current += 1;
    };
  }, []);

  useEffect(() => {
    if (source) parse(source, selectedCompany);
    // A concurrent workspace change must refresh the preview before import.
  }, [data, revision]);

  function parse(text: string, destination: string) {
    setPreview(null);
    setPreviewRevision('');
    setError('');
    if (!text) return;
    try {
      setPreview(previewPostsCsv(text, data, destination));
      setPreviewRevision(revision);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t(
              'This CSV could not be read. Check its format and try again.',
              'อ่านไฟล์ CSV ไม่สำเร็จ ตรวจสอบรูปแบบแล้วลองอีกครั้ง',
            ),
      );
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    const request = ++pendingRead.current;
    setError('');
    setPreview(null);
    setSource('');
    setFileName(file.name);
    if (!/\.csv$/i.test(file.name)) {
      setError(
        t(
          'Choose a .csv file exported from your spreadsheet.',
          'เลือกไฟล์ .csv ที่ส่งออกจากสเปรดชีต',
        ),
      );
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(t('Choose a CSV smaller than 10 MB.', 'เลือกไฟล์ CSV ที่มีขนาดเล็กกว่า 10 MB'));
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      if (request !== pendingRead.current) return;
      if (!text.trim()) {
        setError(
          t(
            'This CSV is empty. Choose a file with a header and at least one post.',
            'ไฟล์ CSV นี้ว่างเปล่า เลือกไฟล์ที่มีหัวคอลัมน์และอย่างน้อยหนึ่งโพสต์',
          ),
        );
        return;
      }
      setSource(text);
      parse(text, selectedCompany);
    } catch {
      if (request === pendingRead.current)
        setError(
          t(
            'The file could not be opened. Please choose it again.',
            'เปิดไฟล์ไม่สำเร็จ กรุณาเลือกไฟล์อีกครั้ง',
          ),
        );
    } finally {
      if (request === pendingRead.current) setReading(false);
    }
  }

  function changeCompany(value: string) {
    setSelectedCompany(value);
    parse(source, value);
  }

  async function confirm() {
    if (!preview?.posts.length || !source || !previewRevision || importing) return;
    setImporting(true);
    setError('');
    try {
      await onImport(source, selectedCompany, previewRevision);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t(
              'Import failed. Your existing posts are unchanged.',
              'นำเข้าไม่สำเร็จ โพสต์เดิมของคุณยังคงอยู่',
            ),
      );
      setImporting(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob(
      [
        '\uFEFFproduct,group,group_id,post_id,url,published_at,viewers\r\n"Product or campaign","","","","","",""\r\n',
      ],
      { type: 'text/csv;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vetra-posts-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="import-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className={styles.header}>
        <div className={styles.headerIcon}>
          <FileSpreadsheet size={24} />
        </div>
        <div>
          <span className={styles.eyebrow}>
            {t('TRACK POSTS ALREADY LIVE', 'ติดตามโพสต์ที่เผยแพร่แล้ว')}
          </span>
          <h2 id="import-title">{t('Import published posts', 'นำเข้าโพสต์ที่เผยแพร่แล้ว')}</h2>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('Close import', 'ปิดการนำเข้า')}
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </header>
      <div className={styles.body}>
        <p className={styles.intro}>
          {t(
            'Each row needs its actual publication date and a post URL, or both Facebook Group ID and Post ID. Review the preview before importing.',
            'แต่ละแถวต้องมีวันที่เผยแพร่จริงและ URL โพสต์ หรือทั้ง Facebook Group ID และ Post ID ตรวจสอบตัวอย่างก่อนนำเข้า',
          )}
        </p>
        <div className={styles.companyLabel}>
          <SelectionField
            label={t('Default company', 'บริษัทเริ่มต้น')}
            value={selectedCompany}
            options={sortCatalog(data.companies).map((store) => ({
              value: store.id,
              en: store.name,
              th: store.name,
            }))}
            t={t}
            onSelect={changeCompany}
            disabled={reading || importing}
          />
          <span>
            {t(
              'Used for rows without a matching company.',
              'ใช้สำหรับแถวที่ไม่ได้ระบุบริษัทที่ตรงกัน',
            )}
          </span>
        </div>
        <div className={`${styles.uploadZone} ${fileName ? styles.hasFile : ''}`}>
          <div className={styles.uploadIcon}>
            {fileName ? <FileSpreadsheet size={27} /> : <Upload size={27} />}
          </div>
          <strong>{fileName || t('Choose your posts CSV', 'เลือกไฟล์ CSV ของโพสต์')}</strong>
          <p>
            {reading
              ? t('Reading your file…', 'กำลังอ่านไฟล์…')
              : t('UTF-8 CSV · up to 10 MB', 'ไฟล์ CSV แบบ UTF-8 · สูงสุด 10 MB')}
          </p>
          <input
            ref={fileInput}
            className={styles.fileInput}
            type="file"
            accept=".csv,text/csv"
            onChange={chooseFile}
            aria-label={t('Choose a CSV file', 'เลือกไฟล์ CSV')}
            disabled={reading || importing}
          />
          <button
            className={styles.chooseButton}
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={reading || importing}
          >
            {fileName
              ? t('Choose another file', 'เลือกไฟล์อื่น')
              : t('Choose CSV file', 'เลือกไฟล์ CSV')}
            <ArrowRight size={17} />
          </button>
        </div>
        <div className={styles.template}>
          <span>{t('Need a starting point?', 'ต้องการรูปแบบตัวอย่าง?')}</span>
          <button type="button" onClick={downloadTemplate}>
            <ArrowDownToLine size={16} />
            {t('Download template', 'ดาวน์โหลดตัวอย่าง')}
          </button>
        </div>
        {error && (
          <div role="alert" className={styles.error}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}
        {preview && (
          <section className={styles.preview} aria-labelledby="csv-preview-title">
            <div className={styles.previewTitle}>
              <h3 id="csv-preview-title">{t('Review your import', 'ตรวจสอบข้อมูลนำเข้า')}</h3>
              <span>
                <Check size={15} />
                {t('Preview only', 'ตัวอย่างก่อนนำเข้า')}
              </span>
            </div>
            <div className={styles.summary}>
              <div>
                <strong>{preview.posts.length.toLocaleString()}</strong>
                <span>{t('published posts ready', 'โพสต์ที่เผยแพร่พร้อมนำเข้า')}</span>
              </div>
              <div>
                <strong>{preview.groups.length.toLocaleString()}</strong>
                <span>{t('new groups', 'กลุ่มใหม่')}</span>
              </div>
              <div>
                <strong>
                  {(
                    preview.skipped +
                    preview.errors.filter((issue) => /^Row \d+:/.test(issue)).length
                  ).toLocaleString()}
                </strong>
                <span>{t('rows skipped', 'แถวที่ข้าม')}</span>
              </div>
            </div>
            {preview.errors.length > 0 && (
              <div className={styles.issues}>
                <p>
                  <AlertCircle size={17} />
                  <strong>{t('Some rows need attention', 'มีบางแถวที่ต้องตรวจสอบ')}</strong>
                </p>
                <ul>
                  {preview.errors.slice(0, 10).map((issue, index) => (
                    <li key={`${index}-${issue}`}>{issueText(issue, t)}</li>
                  ))}
                </ul>
                {preview.errors.length > 10 && (
                  <p>
                    {t(
                      `${preview.errors.length - 10} more issues. Correct the CSV and try again for a complete import.`,
                      `มีอีก ${preview.errors.length - 10} รายการ กรุณาแก้ไขไฟล์ CSV แล้วลองอีกครั้งเพื่อนำเข้าข้อมูลทั้งหมด`,
                    )}
                  </p>
                )}
                <span>
                  {t(
                    'Only valid rows will be imported. Skipped rows will remain in your original file.',
                    'นำเข้าเฉพาะแถวที่ถูกต้อง ข้อมูลแถวที่ข้ามยังคงอยู่ในไฟล์ต้นฉบับ',
                  )}
                </span>
              </div>
            )}
            {!!preview.posts.length && (
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>{t('Post', 'โพสต์')}</th>
                      <th>{t('Platform', 'แพลตฟอร์ม')}</th>
                      <th>{t('Publication date', 'วันที่เผยแพร่')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.posts.slice(0, 6).map((post) => (
                      <tr key={post.id}>
                        <td>
                          <strong>
                            {post.product ||
                              post.facebookPostId ||
                              t('Published post', 'โพสต์ที่เผยแพร่แล้ว')}
                          </strong>
                          <span>
                            {data.groups.find((group) => group.id === post.groupId)?.name ||
                              preview.groups.find((group) => group.id === post.groupId)?.name ||
                              data.companies.find((store) => store.id === post.companyId)?.name ||
                              '—'}
                          </span>
                        </td>
                        <td>{post.platform.charAt(0).toUpperCase() + post.platform.slice(1)}</td>
                        <td>
                          <span className={styles.status}>
                            {post.publishedAt
                              ? formatCalendarDate(reportingDate(post.publishedAt))
                              : '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.posts.length > 6 && (
              <p className={styles.moreRows}>
                {t(
                  `Showing 6 of ${preview.posts.length} valid posts.`,
                  `แสดง 6 จาก ${preview.posts.length} โพสต์ที่ถูกต้อง`,
                )}
              </p>
            )}
            {!preview.posts.length && (
              <p className={styles.noRows}>
                {t(
                  'No published posts are ready to import. Check the listed issues or choose another CSV.',
                  'ยังไม่มีโพสต์ที่เผยแพร่แล้วพร้อมนำเข้า ตรวจสอบข้อผิดพลาดหรือเลือกไฟล์ CSV อื่น',
                )}
              </p>
            )}
          </section>
        )}
        <details className={styles.help}>
          <summary>{t('CSV formatting tips', 'คำแนะนำรูปแบบ CSV')}</summary>
          <p>
            {t(
              'Fill published_at and either url or both group_id and post_id in every row. Keep IDs as text to preserve long numbers. Dates and times use Bangkok (UTC+7) unless a timezone is provided.',
              'กรอก published_at และ url หรือทั้ง group_id และ post_id ในทุกแถว ตั้งค่า ID เป็นข้อความเพื่อรักษาตัวเลขทุกหลัก วันและเวลาอ้างอิงกรุงเทพฯ (UTC+7) หากไม่ได้ระบุเขตเวลา',
            )}
          </p>
          <p>
            {t(
              'Importing adds existing published posts to this tracker. It does not publish posts or fetch live viewer counts.',
              'การนำเข้าจะเพิ่มโพสต์ที่เผยแพร่แล้วในเครื่องมือติดตามนี้ โดยไม่ได้เผยแพร่โพสต์หรือดึงยอดผู้ชมแบบสด',
            )}
          </p>
        </details>
      </div>
      <footer className={styles.footer}>
        <button type="button" className={styles.cancelButton} onClick={onClose}>
          {t('Cancel', 'ยกเลิก')}
        </button>
        <button
          type="button"
          className={styles.importButton}
          disabled={!preview?.posts.length || reading || importing}
          onClick={confirm}
        >
          <Check size={18} />
          {importing
            ? t('Importing…', 'กำลังนำเข้า…')
            : preview?.posts.length
              ? t(`Import ${preview.posts.length} posts`, `นำเข้า ${preview.posts.length} โพสต์`)
              : t('Import posts', 'นำเข้าโพสต์')}
        </button>
      </footer>
    </dialog>
  );
}
