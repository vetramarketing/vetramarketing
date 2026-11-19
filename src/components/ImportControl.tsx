'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import type { Translate, Workspace } from '@/lib/types';
import ImportDialog from './ImportDialog';

type Props = {
  data: Workspace;
  revision: string;
  companyId: string;
  t: Translate;
  className: string;
  disabled?: boolean;
  onImport: (source: string, destination: string, previewRevision: string) => Promise<void>;
};

export default function ImportControl({
  data,
  revision,
  companyId,
  t,
  className,
  disabled,
  onImport,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className={className}
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
      >
        <Upload size={17} />
        {t('Import', 'นำเข้า')}
      </button>
      {open && (
        <ImportDialog
          data={data}
          revision={revision}
          companyId={companyId}
          t={t}
          onImport={async (source, destination, previewRevision) => {
            await onImport(source, destination, previewRevision);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
