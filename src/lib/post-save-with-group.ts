import { preparePostSave } from './post-save';
import { facebookGroupKeyFromText } from './facebook-group-link';
import { normalizeFacebookGroupKey, parseFacebookGroupPostLink } from './facebook-post-url';
import { groupFacebookKey, groupMatchesFacebookKey } from './post-group-selection';
import type { Group, Post, Workspace } from './types';

export type PostGroupSaveReason = 'invalid-group' | 'group-in-trash' | 'group-id-collision';

const messages: Record<PostGroupSaveReason, string> = {
  'invalid-group': 'The Facebook group details do not match this post.',
  'group-in-trash': 'This Facebook group is in Trash. Restore it before saving the post.',
  'group-id-collision': 'This group ID is already used by another group. Try saving again.',
};

export class PostGroupSaveError extends Error {
  readonly code = 'POST_GROUP_SAVE';
  readonly reason: PostGroupSaveReason;

  constructor(reason: PostGroupSaveReason) {
    super(messages[reason]);
    this.name = 'PostGroupSaveError';
    this.reason = reason;
  }
}

/** Save a post and its new Facebook group against one fresh workspace snapshot. */
export function preparePostSaveWithGroup(
  latest: Workspace,
  post: Post,
  baseline: Post | null,
  pendingGroup: Group | null,
): Workspace {
  if (!pendingGroup) return preparePostSave(latest, post, baseline);

  const key = groupFacebookKey(pendingGroup);
  const notesKey = normalizeFacebookGroupKey(facebookGroupKeyFromText(pendingGroup.notes));
  const link = parseFacebookGroupPostLink(post.url);
  if (
    !pendingGroup.id.trim() ||
    pendingGroup.deletedAt ||
    post.groupId !== pendingGroup.id ||
    post.companyId !== pendingGroup.companyId ||
    post.platform !== 'facebook' ||
    !latest.companies.some((store) => store.id === pendingGroup.companyId) ||
    (pendingGroup.facebookId !== '' && !/^\d{1,40}$/.test(pendingGroup.facebookId)) ||
    !key ||
    (pendingGroup.facebookId &&
      /^\d{1,40}$/.test(notesKey) &&
      notesKey !== pendingGroup.facebookId) ||
    (!pendingGroup.facebookId &&
      (!link ||
        !groupMatchesFacebookKey(pendingGroup, link.groupId) ||
        post.facebookPostId !== link.postId)) ||
    (link &&
      (!groupMatchesFacebookKey(pendingGroup, link.groupId) ||
        (post.facebookPostId && post.facebookPostId !== link.postId)))
  ) {
    throw new PostGroupSaveError('invalid-group');
  }

  const keys = new Set([key, notesKey].filter(Boolean));
  const matchingGroups = latest.groups.filter(
    (group) =>
      group.companyId === pendingGroup.companyId &&
      [...keys].some((candidate) => groupMatchesFacebookKey(group, candidate)),
  );
  const activeGroups = matchingGroups.filter((group) => !group.deletedAt);
  if (activeGroups.length > 1) throw new PostGroupSaveError('invalid-group');
  const activeGroup = activeGroups[0];
  if (activeGroup) {
    if (
      activeGroup.facebookId &&
      [...keys].some(
        (candidate) => /^\d{1,40}$/.test(candidate) && candidate !== activeGroup.facebookId,
      )
    )
      throw new PostGroupSaveError('invalid-group');
    return preparePostSave(
      latest,
      {
        ...post,
        groupId: activeGroup.id,
        ...(post.destinationId === pendingGroup.id ? { destinationId: activeGroup.id } : {}),
      },
      baseline,
    );
  }
  if (matchingGroups.length) throw new PostGroupSaveError('group-in-trash');

  if (latest.groups.some((group) => group.id === pendingGroup.id)) {
    throw new PostGroupSaveError('group-id-collision');
  }

  return preparePostSave(
    { ...latest, groups: [...latest.groups, { ...pendingGroup }] },
    post,
    baseline,
  );
}
