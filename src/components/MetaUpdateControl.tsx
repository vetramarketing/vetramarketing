'use client';

import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import type { Translate, Workspace } from '@/lib/types';
import type { MetaUpdateOptions } from '@/lib/meta-viewers-import';
import MetaUpdateDialog from './MetaUpdateDialog';

type Props = {
  data: Workspace;
  revision: string;
  t: Translate;
  className: string;
  disabled: boolean;
  onApply: (source: string, previewRevision: string, options: MetaUpdateOptions) => Promise<void>;
};

export default function MetaUpdateControl({
  data,
  revision,
  t,
  className,
  disabled,
  onApply,
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
        <TrendingUp size={16} />
        {t('Update metrics', 'อัปเดตสถิติ')}
      </button>
      {open && (
        <MetaUpdateDialog
          data={data}
          revision={revision}
          t={t}
          onApply={async (source, previewRevision, options) => {
            await onApply(source, previewRevision, options);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
