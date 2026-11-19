'use client';

import { useEffect, useRef, useState } from 'react';
import { sessionDeniedEvent } from '@/lib/workspace-api-fetch';
import type { View } from '@/lib/types';
import MarketingApp from './MarketingApp';
import styles from './AuthenticatedWorkspace.module.css';

type Phase = 'checking' | 'ready' | 'unavailable' | 'locking' | 'lock-failed' | 'signed-out';
const lockSignal = 'vetra-marketing.session-locked';

/** The server gates the page; recheck before opening any browser data, including recovery copies. */
export default function AuthenticatedWorkspace({ initialView }: { initialView?: View }) {
  const [opened, setOpened] = useState(false);
  const [phase, setPhase] = useState<Phase>('checking');
  const [english, setEnglish] = useState(false);
  const shield = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const actions = useRef<{ lock: () => void; check: () => void } | null>(null);

  // Navigate after the editors unmount and remove their unsaved-change unload listeners.
  useEffect(() => {
    if (phase === 'signed-out')
      location.replace('/unlock?next=' + encodeURIComponent(location.pathname));
  }, [phase]);

  useEffect(() => {
    let active = true;
    let leaving = false;
    let lockRequested = false;
    let lockPending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: AbortController | null = null;
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(lockSignal);
    } catch {
      /* Storage events cover other tabs. */
    }

    function cover(next: Phase) {
      document.documentElement.dataset.vetraCovered = '';
      if (content.current) content.current.inert = true;
      if (shield.current && !shield.current.open) shield.current.showModal();
      try {
        setEnglish(localStorage.getItem('vetra-marketing.locale') === 'en');
      } catch {
        setEnglish(document.documentElement.lang === 'en');
      }
      setPhase(next);
    }
    function endSession(notify: boolean) {
      if (!active || leaving) return;
      leaving = true;
      pending?.abort();
      clearTimeout(timer);
      cover('signed-out');
      setOpened(false);
      if (notify) {
        channel?.postMessage('locked');
        try {
          localStorage.setItem(lockSignal, crypto.randomUUID());
        } catch {
          /* Channel remains available. */
        }
      }
    }
    async function check() {
      if (!active || leaving || lockRequested || pending) return;
      cover('checking');
      const controller = new AbortController();
      pending = controller;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('/api/access/status', {
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
        });
        if (!active || leaving || lockRequested || pending !== controller) return;
        if (response.status === 401) {
          endSession(false);
          return;
        }
        if (!response.ok) throw new Error();
        const status = await response.json();
        if (!active || leaving || lockRequested || pending !== controller) return;
        if (
          status.authenticated !== true ||
          !Number.isSafeInteger(status.expiresAt) ||
          status.expiresAt <= Date.now()
        )
          throw new Error();
        clearTimeout(timer);
        timer = setTimeout(
          () => void check(),
          Math.min(status.expiresAt - Date.now(), 2_147_483_647),
        );
        if (document.visibilityState === 'hidden') return;
        setOpened(true);
        setPhase('ready');
        shield.current?.close();
        if (content.current) content.current.inert = false;
        delete document.documentElement.dataset.vetraCovered;
      } catch {
        if (active && !leaving && !lockRequested && pending === controller) cover('unavailable');
      } finally {
        clearTimeout(timeout);
        if (pending === controller) pending = null;
      }
    }
    async function lock() {
      if (!active || leaving || lockPending) return;
      lockRequested = lockPending = true;
      pending?.abort();
      pending = null;
      clearTimeout(timer);
      cover('locking');
      try {
        const response = await fetch('/api/access/lock', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'follow',
          signal: AbortSignal.timeout(10000),
        });
        if (!active || leaving) return;
        const destination = response.redirected ? new URL(response.url) : null;
        if (
          response.status === 401 ||
          (response.ok &&
            destination?.origin === location.origin &&
            destination.pathname === '/unlock')
        ) {
          endSession(true);
          return;
        }
      } catch {
        /* The server may have completed the lock before the response was lost. */
      }
      if (!active || leaving) return;
      try {
        const status = await fetch('/api/access/status', {
          cache: 'no-store',
          credentials: 'same-origin',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        });
        if (status.status === 401) {
          endSession(true);
          return;
        }
      } catch {
        /* Keep the workspace covered until a retry confirms the result. */
      }
      if (active && !leaving) {
        lockPending = false;
        cover('lock-failed');
      }
    }
    function suspend() {
      if (!active || leaving || lockRequested) return;
      pending?.abort();
      pending = null;
      cover('checking');
    }
    const visibility = () => {
      if (document.visibilityState === 'hidden') suspend();
      else void check();
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) void check();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === lockSignal && event.newValue) endSession(false);
    };
    const denied = () => endSession(true);
    const reconnect = () => {
      if (document.visibilityState === 'visible') void check();
    };
    if (channel)
      channel.onmessage = (event) => {
        if (event.data === 'locked') endSession(false);
      };
    actions.current = { lock, check };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', restored);
    window.addEventListener('popstate', reconnect);
    window.addEventListener('online', reconnect);
    window.addEventListener('storage', storage);
    window.addEventListener(sessionDeniedEvent, denied);
    void check();
    return () => {
      active = false;
      pending?.abort();
      clearTimeout(timer);
      channel?.close();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', restored);
      window.removeEventListener('popstate', reconnect);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('storage', storage);
      window.removeEventListener(sessionDeniedEvent, denied);
      delete document.documentElement.dataset.vetraCovered;
      actions.current = null;
    };
  }, []);

  const text = (en: string, th: string) => (english ? en : th);
  const message =
    phase === 'lock-failed'
      ? text(
          'Could not confirm the lock. Reconnect and try again.',
          'ยังยืนยันการล็อกไม่ได้ กรุณาเชื่อมต่อแล้วลองอีกครั้ง',
        )
      : phase === 'unavailable'
        ? text(
            'Could not verify your session. Check your connection and try again.',
            'ตรวจสอบเซสชันไม่ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง',
          )
        : phase === 'locking' || phase === 'signed-out'
          ? text('Locking workspace…', 'กำลังล็อกพื้นที่ทำงาน…')
          : text('Checking session…', 'กำลังตรวจสอบเซสชัน…');
  return (
    <>
      <div ref={content}>
        {opened && (
          <MarketingApp initialView={initialView} onLock={() => actions.current?.lock()} />
        )}
      </div>
      <dialog
        ref={shield}
        className={styles.shield}
        data-vetra-shield
        aria-label={text('Workspace access', 'การเข้าถึงพื้นที่ทำงาน')}
        onCancel={(event) => event.preventDefault()}
      >
        <div className={styles.status}>
          <img src="/logo_white.svg" width={1211} height={202} alt="VETRA" />
          <p role="status">{message}</p>
          {(phase === 'unavailable' || phase === 'lock-failed') && (
            <button
              type="button"
              onClick={() =>
                phase === 'lock-failed' ? actions.current?.lock() : actions.current?.check()
              }
            >
              {phase === 'lock-failed'
                ? text('Retry lock', 'ลองล็อกอีกครั้ง')
                : text('Retry', 'ลองอีกครั้ง')}
            </button>
          )}
        </div>
      </dialog>
    </>
  );
}
