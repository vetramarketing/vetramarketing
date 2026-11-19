'use client';

import type { PostStatusFilter } from '@/lib/post-tools';
import type { Translate } from '@/lib/types';
import { SelectionControl, type SelectionTrigger } from './SelectionDialog';

export const postStatusOptions = [
  {
    value: 'normal',
    en: 'Normal',
    th: 'ปกติ',
    descriptionEn: 'Posts with a publication date and a ready link',
    descriptionTh: 'โพสต์ที่มีวันที่เผยแพร่และลิงก์พร้อมเปิด',
  },
  {
    value: 'pending',
    en: 'Pending',
    th: 'รอดำเนินการ',
    descriptionEn: 'Posts marked Pending or without a confirmed publication date',
    descriptionTh: 'โพสต์ที่ตั้งสถานะรอดำเนินการ หรือยังไม่มีวันที่เผยแพร่ที่ยืนยันแล้ว',
  },
  {
    value: 'no-link',
    en: 'No link',
    th: 'ไม่มีลิงก์',
    descriptionEn: 'Posts without a usable link, including pending ones',
    descriptionTh: 'โพสต์ที่ไม่มีลิงก์พร้อมเปิด รวมโพสต์ที่รอดำเนินการ',
  },
  {
    value: 'all',
    en: 'All',
    th: 'ทั้งหมด',
    descriptionEn: 'Every tracked post',
    descriptionTh: 'โพสต์ที่ติดตามทั้งหมด',
  },
] as const;

export default function PostStatusDialog(props: {
  value: PostStatusFilter;
  t: Translate;
  onSelect: (value: PostStatusFilter) => void;
  trigger: SelectionTrigger;
}) {
  return (
    <SelectionControl
      {...props}
      title={props.t('Filter post status', 'กรองสถานะโพสต์')}
      options={postStatusOptions}
    />
  );
}
