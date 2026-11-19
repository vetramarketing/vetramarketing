'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { Customer, Locale, Post, Translate, View, Workspace } from '@/lib/types';
import QuickSearch from './QuickSearch';

export type QuickSearchControlHandle = {
  open: () => void;
  toggle: () => void;
  isOpen: () => boolean;
};

type Props = {
  data: Workspace;
  locale: Locale;
  t: Translate;
  className: string;
  onNavigate: (view: View) => void;
  onOpenPost: (post: Post) => void;
  onOpenCustomer: (customer: Customer) => void;
  onSelectCompany: (id: string) => void;
  onCreatePost?: () => void;
};

const QuickSearchControl = forwardRef<QuickSearchControlHandle, Props>(function QuickSearchControl(
  {
    data,
    locale,
    t,
    className,
    onNavigate,
    onOpenPost,
    onOpenCustomer,
    onSelectCompany,
    onCreatePost,
  },
  ref,
) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);

  function setSearchOpen(next: boolean) {
    openRef.current = next;
    setOpen(next);
  }

  useImperativeHandle(ref, () => ({
    open: () => setSearchOpen(true),
    toggle: () => setSearchOpen(!openRef.current),
    isOpen: () => openRef.current,
  }));

  return (
    <>
      <button
        className={className}
        onClick={() => setSearchOpen(true)}
        aria-label={t('Search workspace', 'ค้นหาในพื้นที่ทำงาน')}
        aria-haspopup="dialog"
        title={t('Search workspace (Ctrl / ⌘ K)', 'ค้นหาในพื้นที่ทำงาน (Ctrl / ⌘ K)')}
      >
        <Search size={18} />
        <span>{t('Find anything…', 'ค้นหาได้ทุกอย่าง…')}</span>
        <kbd>Ctrl K</kbd>
      </button>
      {open && (
        <QuickSearch
          data={data}
          locale={locale}
          t={t}
          onClose={() => setSearchOpen(false)}
          onNavigate={onNavigate}
          onOpenPost={onOpenPost}
          onOpenCustomer={onOpenCustomer}
          onSelectCompany={onSelectCompany}
          onCreatePost={onCreatePost}
        />
      )}
    </>
  );
});

export default QuickSearchControl;
