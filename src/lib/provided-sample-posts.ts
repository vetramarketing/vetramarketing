import { knownFacebookGroupHandleName, knownFacebookGroupName } from './facebook-group-directory';

/** User-supplied published posts. The Viewers totals were measured on 2026-10-16 ICT.
 * Earlier source totals remain here only to recognize and update existing imports. */
export const providedSamplePosts: ReadonlyArray<{
  group: string;
  postId: string;
  publishedAtIct: string;
  viewersPerDay: number | null;
  viewers: number | null;
}> = [
  {
    group: '878540877111439',
    postId: '1441014217530766',
    publishedAtIct: '2026-10-11 10:19',
    viewersPerDay: 121.5,
    viewers: 612,
  },
  {
    group: '173647023771535',
    postId: '1595831024886454',
    publishedAtIct: '2026-10-12 00:16',
    viewersPerDay: 5.4,
    viewers: 24,
  },
  {
    group: '508603760935180',
    postId: '1645909573871254',
    publishedAtIct: '2026-10-12 19:24',
    viewersPerDay: 9.0,
    viewers: 33,
  },
  {
    group: '823815689319182',
    postId: '1656569912710418',
    publishedAtIct: '2026-10-12 18:52',
    viewersPerDay: 114.9,
    viewers: 423,
  },
  {
    group: '734552814950824',
    postId: '1658718072534289',
    publishedAtIct: '2026-10-12 19:49',
    viewersPerDay: 11.5,
    viewers: 42,
  },
  {
    group: '744309883464370',
    postId: '1750521226176559',
    publishedAtIct: '2026-10-12 20:34',
    viewersPerDay: 31.8,
    viewers: 115,
  },
  {
    group: '402305850890415',
    postId: '1774948773626109',
    publishedAtIct: '2026-10-12 00:23',
    viewersPerDay: 7.9,
    viewers: 35,
  },
  {
    group: '350320612687055',
    postId: '1791422715243497',
    publishedAtIct: '2026-10-12 19:27',
    viewersPerDay: 24.3,
    viewers: 89,
  },
  {
    group: '173363867184869',
    postId: '1874245667096672',
    publishedAtIct: '2026-10-13 21:51',
    viewersPerDay: 69.2,
    viewers: 177,
  },
  {
    group: '109009523108784',
    postId: '1992041044805613',
    publishedAtIct: '2026-10-12 18:41',
    viewersPerDay: 7.0,
    viewers: 26,
  },
  {
    group: '694232121244129',
    postId: '2029544397712888',
    publishedAtIct: '2026-10-12 19:23',
    viewersPerDay: 22.4,
    viewers: 82,
  },
  {
    group: '546003662963306',
    postId: '2201650280731961',
    publishedAtIct: '2026-10-09 16:21',
    viewersPerDay: null,
    viewers: null,
  },
  {
    group: '1040861603140434',
    postId: '2256016228291626',
    publishedAtIct: '2026-10-12 19:36',
    viewersPerDay: 7.4,
    viewers: 27,
  },
  {
    group: '702644630486591',
    postId: '2332261127524925',
    publishedAtIct: '2026-10-11 23:50',
    viewersPerDay: 2.9,
    viewers: 13,
  },
  {
    group: '423205608513845',
    postId: '2369379663896420',
    publishedAtIct: '2026-10-12 19:14',
    viewersPerDay: 76.1,
    viewers: 279,
  },
  {
    group: '855638428598672',
    postId: '2512366006259231',
    publishedAtIct: '2026-10-12 19:11',
    viewersPerDay: 67.3,
    viewers: 247,
  },
  {
    group: '2959290287506864',
    postId: '27604093915933159',
    publishedAtIct: '2026-10-13 08:36',
    viewersPerDay: 6.1,
    viewers: 19,
  },
  {
    group: '797996580302722',
    postId: '27653901790952170',
    publishedAtIct: '2026-10-13 17:20',
    viewersPerDay: 23.3,
    viewers: 64,
  },
  {
    group: '2884417354969143',
    postId: '28575113882139471',
    publishedAtIct: '2026-10-08 07:23',
    viewersPerDay: null,
    viewers: null,
  },
  {
    group: '2178811188862191',
    postId: '28757854080531207',
    publishedAtIct: '2026-10-11 23:28',
    viewersPerDay: 4.5,
    viewers: 20,
  },
  {
    group: 'halalclub',
    postId: '28824965000503522',
    publishedAtIct: '2026-10-08 07:26',
    viewersPerDay: null,
    viewers: null,
  },
  {
    group: '3769569683076429',
    postId: '29243978951875485',
    publishedAtIct: '2026-10-12 19:34',
    viewersPerDay: 87.6,
    viewers: 320,
  },
  {
    group: '1598962253800976',
    postId: '2942965846067270',
    publishedAtIct: '2026-10-12 00:07',
    viewersPerDay: 3.6,
    viewers: 16,
  },
  {
    group: '1431811837181273',
    postId: '3037285056633935',
    publishedAtIct: '2026-10-12 00:35',
    viewersPerDay: 3.8,
    viewers: 17,
  },
  {
    group: '1483304251837765',
    postId: '3674543759380459',
    publishedAtIct: '2026-10-15 13:24',
    viewersPerDay: 7.7,
    viewers: 7,
  },
  {
    group: '431171997035894',
    postId: '3752700861549641',
    publishedAtIct: '2026-10-08 13:46',
    viewersPerDay: null,
    viewers: null,
  },
];

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

/** Feed the existing import preview, validation, deduplication, and repository commit path. */
export function providedSamplePostsCsv(excludePostIds: ReadonlySet<string> = new Set()): string {
  const headings = [
    'Record ID',
    'Facebook group',
    'Group ID',
    'Platform',
    'Published at (ICT)',
    'Post ID',
    'Complete URL (auto)',
    'Viewers',
  ];
  const rows = providedSamplePosts
    .filter((post) => !excludePostIds.has(post.postId))
    .map((post) => {
      const numericGroup = /^\d+$/.test(post.group);
      const groupName = numericGroup
        ? knownFacebookGroupName(post.group)
        : knownFacebookGroupHandleName(post.group);
      if (!groupName) throw new Error(`Sample group ${post.group} is missing from the directory.`);
      return [
        `provided-${post.postId}`,
        groupName,
        numericGroup ? post.group : '',
        'facebook',
        post.publishedAtIct,
        post.postId,
        `https://www.facebook.com/groups/${post.group}/posts/${post.postId}/`,
        post.viewers === null ? '' : post.viewers,
      ];
    });
  return [headings, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
