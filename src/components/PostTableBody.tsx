'use client';
import { memo, useMemo, useState } from 'react';
import { preconnect } from 'react-dom';
import { Clock3, MousePointerClick, Package, Pencil, Pin } from 'lucide-react';
import { safeCatalogImageUrl } from '@/lib/data';
import { formatCalendarDate } from '@/lib/calendar';
import {
  averageViewersPerDay,
  namedPostDestination,
  postPublicationStatus,
  publicPostUrl,
} from '@/lib/post-tools';
import { bangkokToday, type DailyPostClicks } from '@/lib/post-clicks';
import type { Locale, Post, Translate, View, Workspace } from '@/lib/types';
import s from './MarketingApp.module.css';
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const formatDate = (date: string) =>
  date ? formatCalendarDate(dateFormatter.format(new Date(date))) : '—';
interface Props {
  posts: Post[];
  data: Workspace;
  locale: Locale;
  t: Translate;
  view: View;
  postClicks: DailyPostClicks;
  clickTrackingError: boolean;
  pinSavingId: string | null;
  storageError: boolean;
  togglePostPin: (post: Post) => Promise<void>;
  trackPostOpen: (id: string) => void;
  onEdit: (post: Post) => void;
}
/** Reuse the row tree while the parent updates inputs or unrelated controls. */
const PostTableBody = memo(function PostTableBody({
  posts,
  data,
  locale,
  t,
  view,
  postClicks,
  clickTrackingError,
  pinSavingId,
  storageError,
  togglePostPin,
  trackPostOpen,
  onEdit,
}: Props) {
  const companiesById = useMemo(
    () => new Map(data.companies.map((item) => [item.id, item])),
    [data.companies],
  );
  const groupsById = useMemo(
    () => new Map(data.groups.map((item) => [item.id, item])),
    [data.groups],
  );
  const destinationsById = useMemo(
    () => new Map((data.destinations ?? []).map((item) => [item.id, item])),
    [data.destinations],
  );
  const productsById = useMemo(
    () =>
      new Map(
        (data.products ?? []).filter((item) => !item.deletedAt).map((item) => [item.id, item]),
      ),
    [data.products],
  );
  const uniqueProductsByName = useMemo(() => {
    const index = new Map<string, Workspace['products'][number] | undefined>();
    for (const product of data.products ?? []) {
      if (product.deletedAt) continue;
      const name = product.name.trim();
      index.set(name, index.has(name) ? undefined : product);
    }
    return index;
  }, [data.products]);

  const rateFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale === 'th' ? 'th-TH' : 'en-US', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [locale],
  );
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(locale === 'th' ? 'th-TH' : 'en-US', { maximumFractionDigits: 0 }),
    [locale],
  );
  const fmt = (value: number) => numberFormatter.format(value);
  const rateNow = new Date();
  const clicksTodayByPost = postClicks.day === bangkokToday() ? postClicks.counts : null;
  return (
    <tbody>
      {posts.map((p) => {
        const st = companiesById.get(p.companyId),
          group = groupsById.get(p.groupId),
          destination = destinationsById.get(p.destinationId ?? ''),
          url = publicPostUrl(p, group?.facebookId ?? '');
        const clicksToday = clicksTodayByPost?.[p.id] ?? 0;
        const productName = p.product.trim();
        const product = p.productId
          ? productsById.get(p.productId)
          : uniqueProductsByName.get(productName);
        const destinationName =
          namedPostDestination(
            p,
            destination?.name,
            group?.name,
            t('Facebook Page', 'เพจ Facebook'),
          ) ||
          {
            facebook: 'Facebook',
            instagram: 'Instagram',
            tiktok: 'TikTok',
            linkedin: 'LinkedIn',
          }[p.platform];
        const postIdentity = p.facebookPostId
          ? `${t('post ID', 'รหัสโพสต์')} ${p.facebookPostId}`
          : p.metaSourceRow
            ? t(`Meta row ${p.metaSourceRow}`, `แถว Meta ${p.metaSourceRow}`)
            : `${t('record ID', 'รหัสรายการ')} ${p.id}`;
        const pending = postPublicationStatus(p) === 'pending';
        const postAccessibleName = `${product?.name || productName || 'Null'} — ${destinationName} — ${pending ? t('Pending', 'รอดำเนินการ') : t('Published', 'เผยแพร่แล้ว')} — ${postIdentity}`;
        const clickCountLabel = clickTrackingError
          ? t('Today’s click count unavailable', 'ไม่สามารถแสดงจำนวนคลิกวันนี้ได้')
          : t(`${fmt(clicksToday)} clicks today`, `คลิกวันนี้ ${fmt(clicksToday)} ครั้ง`);
        const viewersPerDay = averageViewersPerDay(p, rateNow);
        const titleContents = (
          <>
            <PostProductThumbnail url={product?.imageUrl ?? ''} />
            <span className={s.postTitleCopy}>
              <span className={s.postTitleHeading}>
                <strong>{product?.name || productName || 'Null'}</strong>
              </span>
            </span>
          </>
        );
        return (
          <tr
            key={p.id}
            className={`${view === 'posts' && url ? s.clickablePostRow : ''} ${p.pinned ? s.pinnedPostRow : ''} ${pending ? s.pendingPostRow : ''}`}
            onPointerEnter={(event) => {
              if (view === 'posts' && url && event.pointerType !== 'touch') warmPostConnection(url);
            }}
            onClick={(event) => {
              if (view !== 'posts' || !url || event.defaultPrevented || event.button !== 0) return;
              if (event.target instanceof Element && event.target.closest('a, button')) return;
              if (window.getSelection()?.toString()) return;
              window.open(url, '_blank', 'noopener,noreferrer');
              trackPostOpen(p.id);
            }}
          >
            <td data-label={t('Post', 'โพสต์')}>
              <div className={s.postCellContent}>
                <button
                  className={`${s.iconButton} ${s.pinButton} ${p.pinned ? s.pinActive : ''}`}
                  type="button"
                  onClick={(event) => {
                    // Pointer focus can pull the viewport to a row after it moves.
                    // Keep keyboard focus for people using Tab/Enter/Space.
                    if (event.detail > 0) event.currentTarget.blur();
                    void togglePostPin(p);
                  }}
                  disabled={pinSavingId !== null || Boolean(storageError)}
                  aria-busy={pinSavingId === p.id}
                  aria-pressed={p.pinned === true}
                  aria-label={`${p.pinned ? t('Unpin post', 'เลิกปักหมุดโพสต์') : t('Pin post', 'ปักหมุดโพสต์')} ${postAccessibleName}`}
                  title={
                    p.pinned
                      ? t('Unpin post', 'เลิกปักหมุดโพสต์')
                      : t('Pin post to top', 'ปักหมุดโพสต์ไว้ด้านบน')
                  }
                >
                  <Pin
                    size={20}
                    strokeWidth={2.2}
                    fill={p.pinned ? 'currentColor' : 'none'}
                    aria-hidden="true"
                  />
                </button>
                <div className={s.postSummary}>
                  {url ? (
                    <a
                      className={s.postTitle}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t(
                        'Open published post in a new tab',
                        'เปิดโพสต์ที่เผยแพร่แล้วในแท็บใหม่',
                      )}
                      aria-label={`${t('Open post', 'เปิดโพสต์')} ${postAccessibleName} — ${clickCountLabel}`}
                      onPointerEnter={(event) => {
                        if (event.pointerType !== 'touch') warmPostConnection(url);
                      }}
                      onFocus={() => warmPostConnection(url)}
                      onClick={() => trackPostOpen(p.id)}
                      onAuxClick={(event) => {
                        if (event.button === 1) trackPostOpen(p.id);
                      }}
                    >
                      {titleContents}
                    </a>
                  ) : (
                    <button
                      className={s.postTitle}
                      title={t('Edit this post to add its link', 'แก้ไขโพสต์นี้เพื่อเพิ่มลิงก์')}
                      onClick={() => onEdit(p)}
                    >
                      {titleContents}
                    </button>
                  )}
                  <div className={s.postMeta}>
                    <small>{st?.name || 'Null'}</small>
                    {p.metaSourceRow && !url && (
                      <small className={s.sourceRow}>
                        {t(`Meta row ${p.metaSourceRow}`, `แถว Meta ${p.metaSourceRow}`)}
                      </small>
                    )}
                    {pending && (
                      <span className={s.pendingPostBadge}>
                        <Clock3 size={14} aria-hidden="true" />
                        {t('Pending', 'รอดำเนินการ')}
                      </span>
                    )}
                    <span className={s.postMetaActions}>
                      <button
                        className={`${s.iconButton} ${s.inlineEdit}`}
                        type="button"
                        onClick={() => onEdit(p)}
                        aria-label={`${t('Edit', 'แก้ไข')} ${postAccessibleName}`}
                        title={t('Edit post', 'แก้ไขโพสต์')}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                      {view === 'posts' &&
                        (url ? (
                          <span
                            className={s.todayClicks}
                            data-click-level={
                              clickTrackingError ? 'unavailable' : Math.min(clicksToday, 7)
                            }
                            title={clickCountLabel}
                          >
                            <MousePointerClick size={13} aria-hidden="true" />
                            <span aria-hidden="true">
                              {clickTrackingError ? '—' : fmt(clicksToday)}
                            </span>
                            <span className={s.srOnly}>{clickCountLabel}</span>
                          </span>
                        ) : (
                          <span className={s.missingLink}>{t('Link: Null', 'ลิงก์: Null')}</span>
                        ))}
                    </span>
                  </div>
                </div>
              </div>
            </td>
            <td data-label={t('Destination', 'ปลายทาง')}>
              <div className={s.destination}>
                <PlatformBadge platform={p.platform} />
                <span>{destinationName}</span>
              </div>
            </td>
            <td data-label={t('Viewers', 'ผู้ชม')}>
              <span className={s.viewerNumber}>{p.viewers === null ? 'Null' : fmt(p.viewers)}</span>
              {pending && p.viewers !== null && (
                <small className={s.pendingMetricNote}>
                  {p.metaSourceRow
                    ? t('Meta · pending', 'Meta · รอดำเนินการ')
                    : t('Pending · excluded', 'รอดำเนินการ · ไม่นับรวม')}
                </small>
              )}
            </td>
            <td data-label={t('Viewer/day', 'ผู้ชม/วัน')}>
              <span className={s.viewerNumber}>
                {viewersPerDay === null ? 'Null' : rateFormatter.format(viewersPerDay)}
              </span>
            </td>
            <td data-label={t('Comments', 'ความคิดเห็น')}>
              <span className={s.viewerNumber}>
                {p.commentCount == null ? '—' : fmt(p.commentCount)}
              </span>
            </td>
            <td className={s.dateCell} data-label={t('Published', 'เผยแพร่เมื่อ')}>
              {p.publishedAt ? formatDate(p.publishedAt) : 'Null'}
              {!p.publishedAt && p.metaPublishedLabel && (
                <small
                  className={s.metaDateHint}
                  title={t(
                    'Date as shown by Meta; year unknown',
                    'วันที่ตามที่ Meta แสดง โดยไม่ทราบปี',
                  )}
                >
                  {t('Meta:', 'Meta:')} {p.metaPublishedLabel}
                </small>
              )}
            </td>
          </tr>
        );
      })}
    </tbody>
  );
});
export default PostTableBody;
/** Warm only the destination origin on user intent, without requesting the post itself. */
function warmPostConnection(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.origin === window.location.origin
    )
      return;
    // React deduplicates repeated hints for posts hosted on the same origin.
    preconnect(url.origin);
  } catch {
    // A speculative hint must never interrupt navigation or editing.
  }
}
function PlatformBadge({ platform = 'facebook' }: { platform?: string }) {
  return (
    <span className={`${s.platform} ${s[platform] || ''}`} title={platform} aria-label={platform}>
      {platform === 'facebook' ? (
        <img src="/icons/Facebook.png" alt="" width={22} height={22} loading="lazy" />
      ) : platform === 'instagram' ? (
        '◎'
      ) : platform === 'linkedin' ? (
        'in'
      ) : (
        '♪'
      )}
    </span>
  );
}

function PostProductThumbnail({ url }: { url: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span className={s.thumbnail} aria-hidden="true">
      {url && safeCatalogImageUrl(url) && failedUrl !== url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <Package size={22} />
      )}
    </span>
  );
}
