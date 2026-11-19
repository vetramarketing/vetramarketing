'use client';

import { useState } from 'react';
import { Import } from 'lucide-react';
import type { Translate, Workspace } from '@/lib/types';
import GroupHtmlImportDialog from './GroupHtmlImportDialog';

type Props = {
  data: Workspace;
  revision: string;
  companyId: string;
  t: Translate;
  className: string;
  disabled: boolean;
  onApply: (source: string, companyId: string, previewRevision: string) => Promise<void>;
};

export default function GroupHtmlImportControl({
  data,
  revision,
  companyId,
  t,
  className,
  disabled,
  onApply,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Import size={16} aria-hidden="true" />
        {t('Import / update groups', 'นำเข้า / อัปเดตกลุ่ม')}
      </button>
      {open && (
        <GroupHtmlImportDialog
          data={data}
          revision={revision}
          companyId={companyId}
          t={t}
          onApply={async (source, destination, previewRevision) => {
            await onApply(source, destination, previewRevision);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
