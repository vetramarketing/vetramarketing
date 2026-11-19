'use client';

import type { PostSort } from '@/lib/post-tools';
import type { Translate } from '@/lib/types';
import { SelectionControl, type SelectionTrigger } from './SelectionDialog';

export const postSortOptions = [
  { value: 'viewers', en: 'Most Viewers', th: 'ผู้ชมมากที่สุด' },
  { value: 'viewers-asc', en: 'Fewest Viewers', th: 'ผู้ชมน้อยที่สุด' },
  { value: 'viewers-per-day', en: 'Most Viewers / Day', th: 'ผู้ชมต่อวันมากที่สุด' },
  { value: 'viewers-per-day-asc', en: 'Fewest Viewers / Day', th: 'ผู้ชมต่อวันน้อยที่สุด' },
  { value: 'comments', en: 'Most Comments', th: 'ความคิดเห็นมากที่สุด' },
  { value: 'comments-asc', en: 'Fewest Comments', th: 'ความคิดเห็นน้อยที่สุด' },
  { value: 'recent', en: 'Newest', th: 'ใหม่ที่สุด' },
  { value: 'date-asc', en: 'Oldest', th: 'เก่าที่สุด' },
  { value: 'title', en: 'Product Name', th: 'ชื่อสินค้า' },
  { value: 'title-desc', en: 'Product Name (reverse)', th: 'ชื่อสินค้า (ย้อนลำดับ)' },
  { value: 'group', en: 'Destination Name', th: 'ชื่อปลายทาง' },
  { value: 'group-desc', en: 'Destination Name (reverse)', th: 'ชื่อปลายทาง (ย้อนลำดับ)' },
  { value: 'company', en: 'Company Name', th: 'ชื่อบริษัท' },
  { value: 'company-desc', en: 'Company Name (reverse)', th: 'ชื่อบริษัท (ย้อนลำดับ)' },
] as const satisfies ReadonlyArray<{ value: PostSort; en: string; th: string }>;

export default function PostSortDialog(props: {
  value: PostSort;
  t: Translate;
  onSelect: (value: PostSort) => void;
  trigger: SelectionTrigger;
}) {
  return (
    <SelectionControl
      {...props}
      title={props.t('Sort posts', 'เรียงลำดับโพสต์')}
      options={postSortOptions}
    />
  );
}
