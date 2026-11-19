import facebookGroupDirectory from './facebook-group-directory.json';
import { reportingDate } from './data';
import { parseFacebookGroupPostUrl, type FacebookGroupPostIds } from './facebook-post-url';
import type { Post, Workspace } from './types';

/** The pasted Meta table is data, never HTML to render in the application. */
export const MAX_META_HTML_LENGTH = 10_000_000;

export interface MetaUpdateChange {
  /** One-based position in the source table. */
  row: number;
  label: string;
  /** Internal workspace post ID, not the Facebook post ID. */
  postId: string;
  oldViewers: number | null;
  newViewers: number;
  oldCommentCount: number | null;
  /** Omitted when the source has no exact Comments count. */
  newCommentCount?: number;
  oldPublishedAt: string;
  newPublishedAt: string;
}

export interface MetaUpdateIssue {
  row: number;
  label: string;
  viewers: number | null;
  commentCount: number | null;
  kind: 'unmatched' | 'ambiguous' | 'invalid' | 'duplicate';
  reason: string;
}

export interface MetaUpdatePreview {
  sourceRows: number;
  changes: MetaUpdateChange[];
  unchanged: MetaUpdateChange[];
  issues: MetaUpdateIssue[];
  warnings: string[];
}

export interface MetaUpdateOptions {
  /** The user-supplied Gregorian publication year when Meta omits one. */
  publicationYear?: number;
  /** Defaults to today's Bangkok date; null means an unknown capture day. */
  capturedOn?: string | null;
  /** Reviewed, one-based source row numbers mapped to their exact Facebook group post URLs. */
  rowPostLinks?: Record<number, string>;
}

interface DateParts {
  day: number;
  month: number;
  hour: number;
  minute: number;
  year?: number;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

interface SourceRow {
  row: number;
  label: string;
  groupName: string;
  viewers: number | null;
  commentCount: number | null;
  date: DateParts | null;
  relativeTime: Pick<DateParts, 'hour' | 'minute'> | null;
  groupPost: FacebookGroupPostIds | null;
  relativeDate: boolean;
  pending: boolean;
  invalidReason?: string;
}

const THAI_MONTHS = new Map([
  ['ม.ค.', 1],
  ['ก.พ.', 2],
  ['มี.ค.', 3],
  ['เม.ย.', 4],
  ['พ.ค.', 5],
  ['มิ.ย.', 6],
  ['ก.ค.', 7],
  ['ส.ค.', 8],
  ['ก.ย.', 9],
  ['ต.ค.', 10],
  ['พ.ย.', 11],
  ['ธ.ค.', 12],
]);

const META_DATE =
  /(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(?:(\d{4})\s*)?เวลา\s*(\d{1,2}):(\d{2})\s*$/u;
const RELATIVE_DATE =
  /(วันนี้|เมื่อวาน(?:นี้)?|today|yesterday)\s*(?:เวลา|at)\s*(\d{1,2}):(\d{2})\s*$/iu;

const RELATIVE_DATE_WITHOUT_LINK =
  'Relative date has no post link or capture date. Enter the Meta table capture date or assign a post link to this row.';
const RELATIVE_DATE_WARNING =
  'Relative dates such as “today” need the Meta table capture date or exact post links to update Viewers.';
const CONFLICTING_ROW_LINK = 'The assigned post link conflicts with a link in the Meta row.';
const CONFLICTING_GROUP_NAME = 'The assigned post belongs to a different known Facebook group.';

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    bull: '•',
  };
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
    const number =
      code[1]?.toLowerCase() === 'x'
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number)
      : entity;
  });
}

function plainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/[\s\u200b]+/gu, ' ')
    .trim();
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? '') : null;
}

function parseWholeCount(cell: string): number | null {
  const value = plainText(cell);
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(value)) return null;
  const number = Number(value.replaceAll(',', ''));
  return Number.isSafeInteger(number) ? number : null;
}

function commentsColumn(source: string): { index: string; inferred: boolean } | null {
  const headers = [...source.matchAll(/<th\b[^>]*>[\s\S]*?<\/th\s*>/gi)];
  // Meta's copied <tbody> has no header, but retains the 14-column layout.
  if (!headers.length) return { index: '9', inferred: true };
  const matches = headers.filter((header) =>
    /^(?:ความคิดเห็น|comments)$/iu.test(plainText(header[0])),
  );
  const index = matches.length === 1 ? attr(matches[0][0], 'aria-colindex') : null;
  return index ? { index, inferred: false } : null;
}

function normalizeYear(value: number): number {
  return value >= 2400 && value <= 2700 ? value - 543 : value;
}

function validYear(value: number): boolean {
  return Number.isInteger(value) && value >= 1900 && value <= 2100;
}

function parseCaptureDate(value: string): CalendarDate {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const year = match ? Number(match[1]) : NaN;
  const month = match ? Number(match[2]) : NaN;
  const day = match ? Number(match[3]) : NaN;
  const utcDay = Date.UTC(year, month - 1, day);
  const calendar = new Date(utcDay);
  if (
    !validYear(year) ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  )
    throw new Error('Meta table capture date must be a valid YYYY-MM-DD date in Thailand time.');
  if (utcDay - 7 * 60 * 60 * 1000 > Date.now())
    throw new Error('Meta table capture date cannot be in the future.');
  return { year, month, day };
}

function resolveRelativeDate(
  label: string,
  time: Pick<DateParts, 'hour' | 'minute'>,
  capturedOn: CalendarDate,
): DateParts {
  const daysBack = /^(?:เมื่อวาน(?:นี้)?|yesterday)$/iu.test(label) ? 1 : 0;
  const day = new Date(Date.UTC(capturedOn.year, capturedOn.month - 1, capturedOn.day - daysBack));
  return {
    year: day.getUTCFullYear(),
    month: day.getUTCMonth() + 1,
    day: day.getUTCDate(),
    ...time,
  };
}

function parseDate(text: string): DateParts | null {
  const match = META_DATE.exec(text);
  if (!match) return null;
  const month = THAI_MONTHS.get(match[2]);
  if (!month) return null;
  const parts: DateParts = {
    day: Number(match[1]),
    month,
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  if (match[3]) parts.year = normalizeYear(Number(match[3]));
  if (parts.day < 1 || parts.day > 31 || parts.hour > 23 || parts.minute > 59) return null;
  if (parts.year !== undefined && !validYear(parts.year)) return null;
  return parts;
}

/** Convert an explicit ICT publication date to UTC only after validating its calendar day. */
function toPublishedAt(parts: DateParts, fallbackYear?: number): string | null {
  const year = parts.year ?? fallbackYear;
  if (year === undefined) return null;
  if (!validYear(year)) return null;
  const calendar = new Date(Date.UTC(year, parts.month - 1, parts.day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== parts.month - 1 ||
    calendar.getUTCDate() !== parts.day
  )
    return null;
  return new Date(
    Date.UTC(year, parts.month - 1, parts.day, parts.hour - 7, parts.minute),
  ).toISOString();
}

function ictParts(iso: string): DateParts | null {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp + 7 * 60 * 60 * 1000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function samePublicationMinute(first: DateParts, second: DateParts): boolean {
  return (
    first.day === second.day &&
    first.month === second.month &&
    first.hour === second.hour &&
    first.minute === second.minute &&
    (first.year === undefined || second.year === undefined || first.year === second.year)
  );
}

function sameGroupPost(first: FacebookGroupPostIds, second: FacebookGroupPostIds): boolean {
  return first.groupId === second.groupId && first.postId === second.postId;
}

function linksInRow(html: string): FacebookGroupPostIds[] {
  const links: FacebookGroupPostIds[] = [];
  // Links inside the post caption may advertise a different post, so they are not identity evidence.
  const outsideCaption = html.replace(/<h2\b[^>]*>[\s\S]*?<\/h2\s*>/gi, '');
  for (const tag of outsideCaption.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attr(tag, 'href');
    if (!href) continue;
    const ids = parseFacebookGroupPostUrl(href);
    if (ids && !links.some((other) => sameGroupPost(other, ids))) links.push(ids);
  }
  return links;
}

function sourceRows(
  source: string,
  capturedOn?: CalendarDate,
  commentColumn = commentsColumn(source),
): SourceRow[] {
  const rows: SourceRow[] = [];
  const tr = /<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tr.exec(source))) {
    const html = match[0];
    const cells = [...html.matchAll(/(<td\b[^>]*>)([\s\S]*?)<\/td\s*>/gi)];
    if (!cells.length) continue; // A full table may include a <thead> row of <th> cells.
    const row = rows.length + 1;
    const content = cells.find((cell) => attr(cell[1], 'aria-colindex') === '2')?.[2] ?? '';
    const viewerCells = cells.filter((cell) => attr(cell[1], 'aria-colindex') === '5');
    const commentCells = commentColumn
      ? cells.filter((cell) => attr(cell[1], 'aria-colindex') === commentColumn.index)
      : [];
    const afterHeading = content.toLowerCase().lastIndexOf('</h2>');
    const metadata = plainText(afterHeading >= 0 ? content.slice(afterHeading + 5) : content);
    const absoluteDate = parseDate(metadata);
    const relativeMatch = !absoluteDate ? RELATIVE_DATE.exec(metadata) : null;
    const relativeDate = Boolean(relativeMatch);
    const relativeTime = relativeMatch
      ? { hour: Number(relativeMatch[2]), minute: Number(relativeMatch[3]) }
      : null;
    const date =
      absoluteDate ??
      (relativeMatch && relativeTime && capturedOn
        ? resolveRelativeDate(relativeMatch[1], relativeTime, capturedOn)
        : null);
    const pending = /(?:^|•)\s*(?:รอดำเนินการ|pending)\s*$/iu.test(metadata);
    const bullet = metadata.lastIndexOf('•');
    const groupName = (date || relativeDate) && bullet >= 0 ? metadata.slice(0, bullet).trim() : '';
    const label = (relativeDate ? metadata : groupName || metadata || `Row ${row}`).slice(0, 120);
    const links = linksInRow(html);
    rows.push({
      row,
      label,
      groupName,
      viewers: viewerCells.length === 1 ? parseWholeCount(viewerCells[0][2]) : null,
      commentCount:
        commentCells.length === 1 && (!commentColumn?.inferred || cells.length === 14)
          ? parseWholeCount(commentCells[0][2])
          : null,
      date,
      relativeTime,
      groupPost: links.length === 1 ? links[0] : null,
      relativeDate,
      pending,
      invalidReason:
        links.length > 1
          ? 'More than one Facebook group post link appears in this row.'
          : viewerCells.length !== 1
            ? 'The Meta Viewers column could not be identified.'
            : pending
              ? 'This row is pending in Meta; confirm publication before updating Viewers.'
              : relativeTime && (relativeTime.hour > 23 || relativeTime.minute > 59)
                ? 'Publication date is not a valid calendar date.'
                : relativeDate && links.length === 0 && !capturedOn
                  ? RELATIVE_DATE_WITHOUT_LINK
                  : undefined,
    });
  }
  return rows;
}

function normalizedName(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\s\u200b]+/gu, ' ')
    .trim()
    .toLocaleLowerCase('th-TH');
}

function knownGroupIdsByName(workspace: Workspace): Map<string, Set<string>> {
  const idsByName = new Map<string, Set<string>>();
  const add = (name: string, id: string) => {
    if (!name || !/^[0-9]{1,40}$/.test(id)) return;
    const key = normalizedName(name);
    const ids = idsByName.get(key);
    if (ids) ids.add(id);
    else idsByName.set(key, new Set([id]));
  };
  for (const group of facebookGroupDirectory.groups) add(group.name, group.facebookId);
  for (const group of workspace.groups) add(group.name, group.facebookId);
  for (const destination of workspace.destinations ?? [])
    if (destination.kind === 'group') add(destination.name, destination.externalId);
  return idsByName;
}

function applyReviewedRowLinks(
  rows: SourceRow[],
  workspace: Workspace,
  rowPostLinks: MetaUpdateOptions['rowPostLinks'],
): void {
  if (rowPostLinks === undefined) return;
  if (!rowPostLinks || typeof rowPostLinks !== 'object' || Array.isArray(rowPostLinks))
    throw new Error('Row post links must be keyed by one-based source row numbers.');
  const groupIdsByName = knownGroupIdsByName(workspace);
  for (const [key, url] of Object.entries(rowPostLinks)) {
    const rowNumber = Number(key);
    if (!/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(rowNumber) || rowNumber > rows.length)
      throw new Error(`Source row ${key} does not exist.`);
    const ids = typeof url === 'string' ? parseFacebookGroupPostUrl(url) : null;
    if (!ids) throw new Error(`Source row ${rowNumber} needs an exact Facebook group post URL.`);
    const row = rows[rowNumber - 1];
    if (row.groupPost && !sameGroupPost(row.groupPost, ids)) {
      row.invalidReason ??= CONFLICTING_ROW_LINK;
      continue;
    }
    if (row.invalidReason && row.invalidReason !== RELATIVE_DATE_WITHOUT_LINK) continue;
    const identifiedGroups = groupIdsByName.get(normalizedName(row.groupName));
    if (identifiedGroups && !identifiedGroups.has(ids.groupId)) {
      row.invalidReason = CONFLICTING_GROUP_NAME;
      continue;
    }
    row.groupPost = ids;
    if (row.invalidReason === RELATIVE_DATE_WITHOUT_LINK) row.invalidReason = undefined;
  }
}

interface MatchIndex {
  byGroupPost: Map<string, Post[]>;
  byMinute: Map<string, Post[]>;
  groupIdsByPost: Map<string, Set<string>>;
}

function minuteKey(date: DateParts): string {
  return `${date.month}-${date.day}-${date.hour}-${date.minute}`;
}

function addMatch(index: Map<string, Post[]>, key: string, post: Post): void {
  const matches = index.get(key);
  if (matches) matches.push(post);
  else index.set(key, [post]);
}

function buildMatchIndex(workspace: Workspace): MatchIndex {
  const index: MatchIndex = {
    byGroupPost: new Map(),
    byMinute: new Map(),
    groupIdsByPost: new Map(),
  };
  const groups = new Map(workspace.groups.map((group) => [group.id, group]));
  const destinations = new Map(
    (workspace.destinations ?? []).map((destination) => [destination.id, destination]),
  );
  for (const post of workspace.posts) {
    if (post.deletedAt || post.platform !== 'facebook' || post.publicationStatus === 'pending')
      continue;
    const group = groups.get(post.groupId);
    const destination = destinations.get(post.destinationId ?? '');
    const fromUrl = parseFacebookGroupPostUrl(post.url);
    const ids = new Set<string>(
      fromUrl
        ? [fromUrl.groupId]
        : [group?.facebookId ?? '', destination?.kind === 'group' ? destination.externalId : ''],
    );
    ids.delete('');
    index.groupIdsByPost.set(post.id, ids);
    const postId = fromUrl?.postId ?? post.facebookPostId;
    if (postId) for (const id of ids) addMatch(index.byGroupPost, `${id}\u0000${postId}`, post);
    const date = ictParts(post.publishedAt);
    // A publication minute can identify a Group post even after the Group is renamed.
    // Exclude Page/account posts: this importer is for Meta's Group table.
    if (date && (fromUrl || group || destination?.kind === 'group'))
      addMatch(index.byMinute, minuteKey(date), post);
  }
  return index;
}

function matchingPosts(
  row: SourceRow,
  index: MatchIndex,
  groupIdsByName: Map<string, Set<string>>,
  publicationYear?: number,
): Post[] {
  const linked = row.groupPost
    ? (index.byGroupPost.get(`${row.groupPost.groupId}\u0000${row.groupPost.postId}`) ?? [])
    : [];
  if (!row.date) return linked;

  // Date and exact ICT minute are the primary match. Keep all candidate years
  // when Meta omitted the year; a collision must remain ambiguous.
  const sourceYear = row.date.year ?? publicationYear;
  const dated = (index.byMinute.get(minuteKey(row.date)) ?? []).filter(
    (post) => sourceYear === undefined || ictParts(post.publishedAt)?.year === sourceYear,
  );
  if (!dated.length) return linked;

  const knownGroupIds = groupIdsByName.get(normalizedName(row.groupName));
  const compatible = knownGroupIds
    ? dated.filter((post) => {
        const postGroupIds = index.groupIdsByPost.get(post.id);
        return Boolean(
          postGroupIds?.size && [...postGroupIds].every((id) => knownGroupIds.has(id)),
        );
      })
    : dated;
  if (!compatible.length) {
    row.invalidReason ??= CONFLICTING_GROUP_NAME;
    return [];
  }
  if (!row.groupPost) return compatible;
  const linkedIds = new Set(linked.map((post) => post.id));
  const matchingLinks = compatible.filter((post) => linkedIds.has(post.id));
  if (!matchingLinks.length) {
    row.invalidReason ??= 'Published date conflicts with the saved date.';
    return [];
  }
  return matchingLinks;
}

/** Safely preview the current Viewers total and known actual date from Meta's table HTML. */
export function previewMetaViewersUpdate(
  source: string,
  workspace: Workspace,
  options: MetaUpdateOptions = {},
): MetaUpdatePreview {
  if (source.length > MAX_META_HTML_LENGTH)
    throw new Error('Meta table is too large (10 MB maximum).');
  if (options.publicationYear !== undefined && !validYear(options.publicationYear))
    throw new Error('Publication year must be a four-digit Gregorian year.');
  const capturedOn =
    options.capturedOn === null
      ? undefined
      : parseCaptureDate(options.capturedOn ?? reportingDate(new Date()));
  const parsed = sourceRows(source, capturedOn);
  if (!parsed.length) throw new Error('No Meta table rows were found. Paste the table HTML.');
  if (parsed.length > 2_000) throw new Error('Meta table has too many rows (2,000 maximum).');
  applyReviewedRowLinks(parsed, workspace, options.rowPostLinks);

  const preview: MetaUpdatePreview = {
    sourceRows: parsed.length,
    changes: [],
    unchanged: [],
    issues: [],
    warnings: [],
  };
  if (
    options.publicationYear === undefined &&
    parsed.some((row) => row.date && row.date.year === undefined)
  )
    preview.warnings.push(
      'The source has no publication year; unknown dates will remain blank unless you enter one.',
    );
  if (parsed.some((row) => row.invalidReason === RELATIVE_DATE_WITHOUT_LINK))
    preview.warnings.push(RELATIVE_DATE_WARNING);
  if (parsed.some((row) => row.pending))
    preview.warnings.push('Pending rows in Meta are skipped until publication is confirmed.');

  const index = buildMatchIndex(workspace);
  const groupIdsByName = knownGroupIdsByName(workspace);
  for (const row of parsed) {
    const identifiedGroups = groupIdsByName.get(normalizedName(row.groupName));
    if (row.groupPost && identifiedGroups && !identifiedGroups.has(row.groupPost.groupId))
      row.invalidReason ??= CONFLICTING_GROUP_NAME;
  }
  const matchedByRow = new Map(
    parsed.map((row) => [
      row.row,
      matchingPosts(row, index, groupIdsByName, options.publicationYear),
    ]),
  );
  const sourceCountByPost = new Map<string, number>();
  for (const row of parsed) {
    if (row.invalidReason || row.viewers === null) continue;
    const matches = matchedByRow.get(row.row) ?? [];
    if (matches.length !== 1) continue;
    const id = matches[0].id;
    sourceCountByPost.set(id, (sourceCountByPost.get(id) ?? 0) + 1);
  }
  const candidates: { change: MetaUpdateChange; row: SourceRow }[] = [];
  for (const row of parsed) {
    const issue = (kind: MetaUpdateIssue['kind'], reason: string) =>
      preview.issues.push({
        row: row.row,
        label: row.label,
        viewers: row.viewers,
        commentCount: row.commentCount,
        kind,
        reason,
      });
    const matches = matchedByRow.get(row.row) ?? [];
    if (matches.length === 1 && (sourceCountByPost.get(matches[0].id) ?? 0) > 1) {
      issue('duplicate', 'More than one source row matches this post.');
      continue;
    }
    if (row.invalidReason) {
      issue('invalid', row.invalidReason);
      continue;
    }
    if (row.viewers === null) {
      issue('invalid', 'Viewers cell is missing or not an exact whole number.');
      continue;
    }
    if (
      !row.relativeDate &&
      row.date?.year !== undefined &&
      options.publicationYear !== undefined &&
      row.date.year !== options.publicationYear
    ) {
      issue('invalid', 'Publication year conflicts with the year in the source row.');
      continue;
    }
    if (!matches.length) {
      issue('unmatched', 'No tracked post matches this row.');
      continue;
    }
    if (matches.length > 1) {
      issue('ambiguous', 'More than one tracked post matches this row.');
      continue;
    }
    const post = matches[0];
    if (row.viewers < (post.viewers ?? 0)) {
      issue('invalid', 'Source Viewers total is lower than the saved total.');
      continue;
    }
    const published = row.date ? toPublishedAt(row.date, options.publicationYear) : null;
    if (
      row.date &&
      (row.date.year !== undefined || options.publicationYear !== undefined) &&
      !published
    ) {
      issue('invalid', 'Publication date is not a valid calendar date.');
      continue;
    }
    if (published && Date.parse(published) > Date.now()) {
      issue('invalid', 'Publication date is in the future.');
      continue;
    }
    const sourceYear = row.date?.year ?? options.publicationYear;
    if (
      published &&
      capturedOn &&
      row.date &&
      sourceYear !== undefined &&
      Date.UTC(sourceYear, row.date.month - 1, row.date.day) >
        Date.UTC(capturedOn.year, capturedOn.month - 1, capturedOn.day)
    ) {
      issue('invalid', 'Publication date is after the Meta table capture date.');
      continue;
    }
    const previous = ictParts(post.publishedAt);
    const effectiveDate =
      row.date && row.date.year === undefined && options.publicationYear !== undefined
        ? { ...row.date, year: options.publicationYear }
        : row.date;
    if (
      post.publishedAt &&
      effectiveDate &&
      previous &&
      !samePublicationMinute(effectiveDate, previous)
    ) {
      issue('invalid', 'Published date conflicts with the saved date.');
      continue;
    }
    if (
      post.publishedAt &&
      row.relativeTime &&
      previous &&
      (row.relativeTime.hour !== previous.hour || row.relativeTime.minute !== previous.minute)
    ) {
      issue('invalid', 'Published date conflicts with the saved date.');
      continue;
    }
    candidates.push({
      row,
      change: {
        row: row.row,
        label: row.label,
        postId: post.id,
        oldViewers: post.viewers,
        newViewers: row.viewers,
        oldCommentCount: post.commentCount ?? null,
        ...(row.commentCount === null ? {} : { newCommentCount: row.commentCount }),
        oldPublishedAt: post.publishedAt,
        newPublishedAt: post.publishedAt || published || '',
      },
    });
  }

  for (const { change, row } of candidates) {
    if (
      change.oldViewers === change.newViewers &&
      (change.newCommentCount === undefined || change.oldCommentCount === change.newCommentCount) &&
      change.oldPublishedAt === change.newPublishedAt
    ) {
      preview.unchanged.push(change);
    } else {
      preview.changes.push(change);
    }
  }
  preview.issues.sort((first, second) => first.row - second.row);
  return preview;
}

/** Apply only reviewed safe fields. The caller must also guard repository revision. */
export function applyMetaViewersUpdate(
  workspace: Workspace,
  preview: MetaUpdatePreview,
): Workspace {
  if (!preview.changes.length) return workspace;
  const changes = new Map<string, MetaUpdateChange>();
  for (const change of preview.changes) {
    if (changes.has(change.postId))
      throw new Error('Duplicate post in Meta preview. Review again.');
    changes.set(change.postId, change);
  }
  // Preserve the first-match behavior while avoiding a full post scan for each
  // reviewed change. The caller still validates the workspace and revision.
  const postsById = new Map<string, Post>();
  for (const post of workspace.posts) if (!postsById.has(post.id)) postsById.set(post.id, post);
  for (const change of changes.values()) {
    const post = postsById.get(change.postId);
    if (
      !post ||
      post.deletedAt ||
      post.platform !== 'facebook' ||
      post.publicationStatus === 'pending' ||
      post.viewers !== change.oldViewers ||
      (post.commentCount ?? null) !== change.oldCommentCount ||
      post.publishedAt !== change.oldPublishedAt
    )
      throw new Error('Post changed since preview. Review the Meta table again.');
    if (
      change.newViewers < (post.viewers ?? 0) ||
      !Number.isSafeInteger(change.newViewers) ||
      change.newViewers < 0 ||
      (change.newCommentCount !== undefined &&
        (!Number.isSafeInteger(change.newCommentCount) || change.newCommentCount < 0)) ||
      (post.publishedAt && post.publishedAt !== change.newPublishedAt)
    )
      throw new Error('Meta preview is no longer safe. Review the table again.');
  }
  return {
    ...workspace,
    posts: workspace.posts.map((post) => {
      const change = changes.get(post.id);
      return change
        ? {
            ...post,
            viewers: change.newViewers,
            ...(change.newCommentCount === undefined
              ? {}
              : { commentCount: change.newCommentCount }),
            publishedAt: change.newPublishedAt,
          }
        : post;
    }),
  };
}
