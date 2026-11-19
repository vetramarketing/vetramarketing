'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Translate } from '@/lib/types';
import s from './MarketingApp.module.css';

export type ToastControlHandle = { show: (message: string) => void };

const ToastControl = forwardRef<ToastControlHandle, { t: Translate }>(function ToastControl(
  { t },
  ref,
) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    show(nextMessage) {
      setMessage(nextMessage);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(''), 4500);
    },
  }));

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return message ? (
    <div className={s.toast} role="status">
      <Check size={19} />
      <span>{message}</span>
      <button
        type="button"
        onClick={() => setMessage('')}
        aria-label={t('Dismiss notification', 'ปิดการแจ้งเตือน')}
      >
        <X size={17} />
      </button>
    </div>
  ) : null;
});

export default ToastControl;
