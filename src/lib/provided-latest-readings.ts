import { providedSamplePosts } from './provided-sample-posts';
import type { Group, Post, Workspace } from './types';

/** Latest Viewers from the user-supplied Meta table, captured 2026-10-17 ICT.
 * The table omitted Facebook IDs, so these values were matched to the supplied
 * posts by unique group name and publication minute before being keyed by post ID. */
export const PROVIDED_VIEWERS_SOURCE_DATE = '2026-10-17';
const viewersByPostId = new Map<string, number>([
  ['1441014217530766', 883],
  ['1595831024886454', 27],
  ['1645909573871254', 37],
  ['1656569912710418', 577],
  ['1658718072534289', 53],
  ['1750521226176559', 138],
  ['1774948773626109', 40],
  ['1791422715243497', 109],
  ['1874245667096672', 314],
  ['1992041044805613', 36],
  ['2029544397712888', 111],
  ['2201650280731961', 80],
  ['2256016228291626', 27],
  ['2332261127524925', 14],
  ['2369379663896420', 281],
  ['2512366006259231', 409],
  ['27604093915933159', 21],
  ['27653901790952170', 72],
  ['28575113882139471', 67],
  ['28757854080531207', 29],
  ['28824965000503522', 24],
  ['29243978951875485', 426],
  ['2942965846067270', 20],
  ['3037285056633935', 18],
  ['3674543759380459', 13],
  ['3752700861549641', 167],
]);

function matchesSample(
  post: Post,
  groupsById: ReadonlyMap<string, Group>,
  sample: (typeof providedSamplePosts)[number],
) {
  if (post.deletedAt || post.platform !== 'facebook' || post.facebookPostId !== sample.postId)
    return false;
  if (
    post.publishedAt !==
    new Date(sample.publishedAtIct.replace(' ', 'T') + ':00+07:00').toISOString()
  )
    return false;
  const group = groupsById.get(post.groupId);
  if (!group || group.deletedAt) return false;
  const expectedUrl = `https://www.facebook.com/groups/${sample.group}/posts/${sample.postId}/`;
  return /^\d+$/.test(sample.group)
    ? group.facebookId === sample.group && post.url === expectedUrl
    : !group.facebookId && post.url === expectedUrl;
}

export interface LatestReadingsResult {
  workspace: Workspace;
  added: number;
  alreadyPresent: number;
  missing: number;
  conflicts: number;
}

/** Apply the supplied total only when a post still has the earlier supplied value. */
export function addProvidedLatestReadings(workspace: Workspace): LatestReadingsResult {
  let added = 0;
  let alreadyPresent = 0;
  let missing = 0;
  let conflicts = 0;
  const updates = new Map<string, Post>();
  const groupsById = new Map(workspace.groups.map((group) => [group.id, group]));
  const postsByFacebookId = new Map<string, Post[]>();
  for (const post of workspace.posts) {
    const candidates = postsByFacebookId.get(post.facebookPostId) ?? [];
    candidates.push(post);
    postsByFacebookId.set(post.facebookPostId, candidates);
  }

  for (const sample of providedSamplePosts) {
    const viewers = viewersByPostId.get(sample.postId);
    if (viewers === undefined) throw new Error(`Missing supplied Viewers for ${sample.postId}.`);
    const candidates = (postsByFacebookId.get(sample.postId) ?? []).filter((post) =>
      matchesSample(post, groupsById, sample),
    );
    if (candidates.length !== 1) {
      missing += 1;
      continue;
    }
    const post = candidates[0];
    if (post.viewers === viewers) {
      alreadyPresent += 1;
      continue;
    }
    if (post.viewers !== sample.viewers) {
      conflicts += 1;
      continue;
    }
    updates.set(post.id, {
      ...post,
      viewers,
    });
    added += 1;
  }

  return {
    workspace: updates.size
      ? { ...workspace, posts: workspace.posts.map((post) => updates.get(post.id) ?? post) }
      : workspace,
    added,
    alreadyPresent,
    missing,
    conflicts,
  };
}
