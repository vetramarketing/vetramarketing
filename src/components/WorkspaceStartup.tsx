import { useEffect, useState } from 'react';
import { readBrowserMigrationSource } from '@/lib/http-workspace-repository';
import { MAX_LABEL_BACKUP_TEXT_BYTES, prepareWorkspaceLabelRestore } from '@/lib/order-labels';
import type { Translate, Workspace } from '@/lib/types';
import styles from './MarketingApp.module.css';

interface Source {
  name: string;
  workspace: Workspace;
  prepare(): Promise<void>;
}

export default function WorkspaceStartup({
  initialize,
  openCache,
  error,
  t,
}: {
  initialize?: (workspace: Workspace) => Promise<unknown>;
  openCache?: () => void;
  error?: string;
  t: Translate;
}) {
  const [source, setSource] = useState<Source | null>(null);
  const [issue, setIssue] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!initialize) return;
    try {
      const saved = readBrowserMigrationSource();
      if (saved)
        setSource({
          name: saved.key,
          workspace: saved.workspace,
          async prepare() {
            if (readBrowserMigrationSource()?.raw !== saved.raw)
              throw new Error('The browser workspace changed. Reload to review the latest data.');
          },
        });
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    }
  }, [initialize]);
  const choose = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setSource(null);
    setIssue('');
    try {
      if (file.size > MAX_LABEL_BACKUP_TEXT_BYTES)
        throw new Error('The workspace backup exceeds 150 MB.');
      const backup = await prepareWorkspaceLabelRestore(
        JSON.parse((await file.text()).replace(/^\uFEFF/, '')),
      );
      setSource({ name: file.name, workspace: backup.workspace, prepare: backup.commitLabels });
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    if (!source || !initialize || busy) return;
    setBusy(true);
    setIssue('');
    try {
      await source.prepare();
      await initialize(source.workspace);
      window.location.reload();
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };
  return (
    <main className={styles.loading}>
      <strong>
        {initialize
          ? t('Import workspace into MongoDB', 'นำเข้าพื้นที่ทำงานไปยัง MongoDB')
          : t('Workspace connection unavailable', 'ไม่สามารถเชื่อมต่อพื้นที่ทำงาน')}
      </strong>
      {initialize && (
        <>
          <p>
            {t(
              'Use this browser’s saved workspace or select a VETRA JSON backup.',
              'ใช้พื้นที่ทำงานที่บันทึกในเบราว์เซอร์นี้ หรือเลือกไฟล์สำรอง JSON ของ VETRA',
            )}
          </p>
          <label>
            {t('Choose backup', 'เลือกไฟล์สำรอง')}{' '}
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void choose(file);
              }}
            />
          </label>
          {source && (
            <p>
              {source.name} · {source.workspace.companies.length} {t('companies', 'บริษัท')} ·{' '}
              {source.workspace.customers.length} {t('customers', 'ลูกค้า')} ·{' '}
              {(source.workspace.orders ?? []).length} {t('orders', 'ออเดอร์')} ·{' '}
              {source.workspace.posts.length} {t('posts', 'โพสต์')}
            </p>
          )}
          <button
            className={styles.primary}
            disabled={!source || busy}
            onClick={() => void start()}
          >
            {busy
              ? t('Processing…', 'กำลังประมวลผล…')
              : t('Import workspace', 'นำเข้าพื้นที่ทำงาน')}
          </button>
        </>
      )}
      {(issue || error) && <p role="alert">{issue || error}</p>}
      {openCache && (
        <button className={styles.primary} onClick={openCache}>
          {t('Open last synced workspace · Read only', 'เปิดสำเนาที่ซิงก์ล่าสุด · อ่านอย่างเดียว')}
        </button>
      )}
      <button className={styles.secondary} disabled={busy} onClick={() => window.location.reload()}>
        {t('Reload', 'โหลดใหม่')}
      </button>
    </main>
  );
}
