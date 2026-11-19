import type { Platform } from './types';

export interface PostEditorFields {
  companyId: string;
  product: string;
  groupId: string;
  platform: Platform;
  postType: 'group' | 'page';
  publicationStatus: 'published' | 'pending';
  facebookGroupId: string;
  publishedAt: string;
  facebookPostId: string;
  url: string;
  color: string;
  viewers: string;
  comments: string;
}

/** Compare what the person typed, before trimming or numeric/date conversion. */
export function postEditorSnapshot(fields: PostEditorFields): string {
  return JSON.stringify([
    fields.companyId,
    fields.product,
    fields.groupId,
    fields.platform,
    fields.postType,
    fields.publicationStatus,
    fields.facebookGroupId,
    fields.publishedAt,
    fields.facebookPostId,
    fields.url,
    fields.color,
    fields.viewers,
    fields.comments,
  ]);
}
