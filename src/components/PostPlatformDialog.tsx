'use client';

import type { Translate } from '@/lib/types';
import { SelectionControl, type SelectionTrigger } from './SelectionDialog';

export const postPlatformOptions = [
  { value: 'all', en: 'All', th: 'ทั้งหมด' },
  { value: 'facebook', en: 'Facebook', th: 'Facebook' },
  { value: 'instagram', en: 'Instagram', th: 'Instagram' },
  { value: 'tiktok', en: 'TikTok', th: 'TikTok' },
  { value: 'linkedin', en: 'LinkedIn', th: 'LinkedIn' },
] as const;

export default function PostPlatformDialog(props: {
  value: string;
  t: Translate;
  onSelect: (value: string) => void;
  trigger: SelectionTrigger;
}) {
  return (
    <SelectionControl
      {...props}
      title={props.t('Filter platform', 'กรองแพลตฟอร์ม')}
      options={postPlatformOptions}
    />
  );
}
