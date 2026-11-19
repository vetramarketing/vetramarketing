import { canonicalPostUrl, safePostUrl, validDate, validateWorkspace } from './data';
import { postPublicationStatus } from './post-tools';
import { productCompanyIdMap } from './product-company';
import { resolveFacebookGroupName } from './facebook-group-directory';
import { buildPostIdentityContext, postIdentityKeys } from './post-identity';
import type { Group, Post, Workspace } from './types';
import { latestLegacyViewers } from './workspace-storage';

const columns = [
  'Record ID',
  'Company ID',
  'Company',
  'Group reference ID',
  'Facebook group',
  'Group ID',
  'Category',
  'Platform',
  'Product',
  'Published at (ICT)',
  'Post ID',
  'Complete URL (auto)',
  'Viewers',
  'Comments',
  'Color',
  'Product ID',
  'Destination ID',
  'Pinned',
  'Publication status',
  'Meta date text',
  'Meta source row',
  'Meta group name',
  'Meta group key',
];
const idColumns = new Set([5, 10]);

function ictTimestamp(value: string): string {
  if (!value) return '';
  return new Date(Date.parse(value) + 7 * 60 * 60 * 1000).toISOString().slice(0, 19) + '+07:00';
}

function escapeCell(value: string, asId = false): string {
  // CSV quoting alone does not prevent spreadsheet formula execution or ID rounding.
  const safe =
    /^[\s]*[=+\-@]/.test(value) || /^[\t\r\n']/.test(value) || (asId && /^\d+$/.test(value))
      ? `'${value}`
      : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function restoreCell(value: string): string {
  return /^'(?:[\s]*[=+\-@]|[\t\r\n']|\d+$)/.test(value) ? value.slice(1) : value;
}

export function exportPostsCsv(workspace: Workspace, companyId?: string): string {
  const rows = workspace.posts
    .filter(
      (post) =>
        (post.status === undefined || post.status === 'published') &&
        !post.deletedAt &&
        (!companyId || post.companyId === companyId),
    )
    .map((post) => {
      const company = workspace.companies.find((item) => item.id === post.companyId);
      const group = workspace.groups.find((item) => item.id === post.groupId);
      const values = [
        post.id,
        post.companyId,
        company?.name ?? '',
        post.groupId,
        group?.name ?? '',
        group?.facebookId ?? '',
        group?.category ?? '',
        post.platform,
        post.product,
        ictTimestamp(post.publishedAt),
        post.facebookPostId,
        canonicalPostUrl(group?.facebookId ?? '', post.facebookPostId) || post.url,
        post.viewers === null ? '' : String(post.viewers),
        post.commentCount == null ? '' : String(post.commentCount),
        post.color,
        post.productId ?? '',
        post.destinationId ?? '',
        post.pinned === true ? 'true' : 'false',
        postPublicationStatus(post),
        post.metaPublishedLabel ?? '',
        post.metaSourceRow === undefined ? '' : String(post.metaSourceRow),
        post.metaGroupName ?? '',
        post.metaGroupKey ?? '',
      ];
      return values.map((value, index) => escapeCell(value, idColumns.has(index))).join(',');
    });
  return '\uFEFF' + [columns.map((column) => escapeCell(column)).join(','), ...rows].join('\r\n');
}

/** A small RFC 4180-style parser; handles quoted commas, quotes, and line breaks. */
export function parseCsv(text: string): string[][] {
  if (text.length > 10 * 1024 * 1024)
    throw new Error('The CSV is too large. Import files smaller than 10 MB.');
  const source = text.replace(/^\uFEFF/, '');
  const delimiters = [',', '\t', ';'] as const;
  const counts = delimiters.map((delimiter) => ({ delimiter, count: 0 }));
  let inQuotes = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      if (inQuotes && source[i + 1] === '"') i += 1;
      else inQuotes = !inQuotes;
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) break;
    if (!inQuotes) {
      const count = counts.find((entry) => entry.delimiter === char);
      if (count) count.count += 1;
    }
  }
  counts.sort((a, b) => b.count - a.count);
  const delimiter = counts[0].delimiter;
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  const finishCell = () => {
    row.push(restoreCell(cell));
    if (row.length > 100) throw new Error('The CSV contains too many columns.');
    cell = '';
    closed = false;
  };
  const finishRow = () => {
    finishCell();
    if (row.some((value) => value.trim())) rows.push(row);
    if (rows.length > 50001) throw new Error('Import at most 50,000 rows at a time.');
    row = [];
  };
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else cell += char;
    } else if (char === delimiter) finishCell();
    else if (char === '\r' || char === '\n') {
      finishRow();
      if (char === '\r' && source[i + 1] === '\n') i += 1;
    } else if (char === '"') {
      if (cell || closed) throw new Error(`Unexpected quote near CSV row ${rows.length + 1}.`);
      quoted = true;
    } else if (closed) {
      if (char !== ' ' && char !== '\t')
        throw new Error(`Unexpected text after a closing quote near CSV row ${rows.length + 1}.`);
    } else cell += char;
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted field.');
  if (cell || row.length || closed) finishRow();
  return rows;
}

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9ก-๙]/g, '');
const aliases: Record<string, string[]> = {
  record: ['recordid', 'id'],
  companyId: ['companyid', 'storeid', 'รหัสบริษัท', 'รหัสร้านค้า'],
  company: [
    'company',
    'companyname',
    'store',
    'storename',
    'บริษัท',
    'ชื่อบริษัท',
    'ร้านค้า',
    'ชื่อร้านค้า',
    'ชื่อร้าน',
  ],
  groupReference: ['groupreferenceid'],
  group: ['facebookgroup', 'group', 'groupname', 'ชื่อกลุ่ม'],
  groupId: ['groupid', 'facebookgroupid'],
  category: ['category'],
  platform: ['platform'],
  title: ['title', 'posttitle', 'หัวข้อ'],
  content: ['content', 'caption', 'postcontent', 'เนื้อหา'],
  product: ['product'],
  productId: ['productid'],
  destinationId: ['destinationid'],
  status: ['status'],
  scheduled: ['scheduledatict', 'scheduledat', 'scheduleddate'],
  posted: [
    'postedatict',
    'postedat',
    'publishedatict',
    'publishedat',
    'publisheddate',
    'วันที่เผยแพร่',
  ],
  postId: ['postid', 'facebookpostid'],
  url: ['completeurlauto', 'completeurl', 'posturl', 'url', 'link'],
  viewers: ['viewers', 'ผู้ชม', 'จำนวนผู้ชม'],
  comments: ['comments', 'commentcount', 'ความคิดเห็น', 'จำนวนความคิดเห็น'],
  measured: ['measuredatict', 'measuredat', 'measurementdate'],
  reportedRate: ['viewersday', 'reportedviewersday'],
  metrics: ['metricsjson'],
  color: ['color'],
  pinned: ['pinned', 'pin'],
  publicationStatus: ['publicationstatus'],
  metaPublishedLabel: ['metadatetext', 'metapublishedlabel'],
  metaSourceRow: ['metasourcerow'],
  metaGroupName: ['metagroupname'],
  metaGroupKey: ['metagroupkey'],
};

function parseDate(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  // Spreadsheet tracker dates use Thai day/month/year and ICT (UTC+07:00).
  const thai = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(
    trimmed,
  );
  const local = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed);
  let result = trimmed;
  if (thai) {
    const year = Number(thai[3]) > 2400 ? Number(thai[3]) - 543 : Number(thai[3]);
    result = `${year}-${thai[2].padStart(2, '0')}-${thai[1].padStart(2, '0')}T${(thai[4] ?? '00').padStart(2, '0')}:${thai[5] ?? '00'}:${thai[6] ?? '00'}+07:00`;
  } else if (local)
    result = `${local[1]}T${local[2] ?? '00'}:${local[3] ?? '00'}:${local[4] ?? '00'}+07:00`;
  if (!validDate(result))
    throw new Error(`${field} is not a valid date. Use YYYY-MM-DD or DD/MM/YYYY.`);
  return new Date(result).toISOString();
}

function facebookIds(url: string): { groupId: string; postId: string } | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return null;
    const match = /^\/groups\/(\d{1,40})\/(?:posts|permalink)\/(\d{1,40})(?:\/|$)/.exec(
      parsed.pathname,
    );
    return match ? { groupId: match[1], postId: match[2] } : null;
  } catch {
    return null;
  }
}

export function previewPostsCsv(
  text: string,
  workspace: Workspace,
  defaultCompanyId: string,
): { posts: Post[]; groups: Group[]; errors: string[]; skipped: number } {
  const result: { posts: Post[]; groups: Group[]; errors: string[]; skipped: number } = {
    posts: [],
    groups: [],
    errors: [],
    skipped: 0,
  };
  const defaultCompany = workspace.companies.find((company) => company.id === defaultCompanyId);
  if (!defaultCompany) return { ...result, errors: ['Choose a company before importing.'] };
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (error) {
    return {
      ...result,
      errors: [error instanceof Error ? error.message : 'Unable to read this CSV.'],
    };
  }
  if (rows.length < 2)
    return { ...result, errors: ['The CSV needs a header and at least one data row.'] };
  const headers = rows[0].map(normalizeHeader);
  const indices = Object.fromEntries(
    Object.entries(aliases).map(([key, values]) => [
      key,
      headers.findIndex((header) => values.includes(header)),
    ]),
  );
  if (
    !['group', 'product', 'postId', 'url', 'record', 'title', 'content'].some(
      (key) => indices[key] >= 0,
    )
  )
    return {
      ...result,
      errors: [
        'No supported columns found. Include Product, Facebook group, Post ID, or Complete URL (auto).',
      ],
    };
  const ignoredMetricColumns = headers.flatMap((header, index) =>
    ['views', 'ยอดเข้าชม'].includes(header) ? [rows[0][index].trim()] : [],
  );
  if (indices.viewers < 0 && ignoredMetricColumns.length)
    result.errors.push(
      `Import note: ${ignoredMetricColumns.join(', ')} was not imported as Viewers. These are different metrics; valid content rows can still be imported.`,
    );
  const identityContext = buildPostIdentityContext(workspace);
  const seen = new Set(
    workspace.posts.flatMap((post) => [
      `record:${post.id}`,
      ...postIdentityKeys(post, workspace, identityContext),
    ]),
  );
  const allGroups = [...workspace.groups];
  const productCompanies = productCompanyIdMap(workspace.products, workspace.posts);
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const read = (key: string) => (indices[key] >= 0 ? (row[indices[key]] ?? '') : '');
    try {
      if (row.length > headers.length)
        throw new Error('This row has more fields than the header. Quote text containing commas.');
      if (
        !['group', 'product', 'postId', 'url', 'record', 'title', 'content'].some((key) =>
          read(key).trim(),
        )
      ) {
        result.skipped += 1;
        continue;
      }
      const companyIdCell = read('companyId').trim();
      const companyName = read('company').trim();
      const company =
        workspace.companies.find((item) => item.id === companyIdCell) ??
        workspace.companies.find((item) => item.name.toLowerCase() === companyName.toLowerCase()) ??
        defaultCompany;
      const sourceUrl = read('url').trim();
      if (!safePostUrl(sourceUrl)) throw new Error('Post URL must be a valid HTTPS link.');
      const publicationStatusCell = read('publicationStatus').trim().toLowerCase();
      if (publicationStatusCell && !['published', 'pending'].includes(publicationStatusCell))
        throw new Error('Publication status must be published or pending.');
      const publicationStatus = publicationStatusCell || 'published';
      const metaSourceRowCell = read('metaSourceRow').trim();
      const metaSourceRow = metaSourceRowCell ? Number(metaSourceRowCell) : undefined;
      if (
        metaSourceRow !== undefined &&
        (!/^\d+$/.test(metaSourceRowCell) ||
          !Number.isInteger(metaSourceRow) ||
          metaSourceRow < 1 ||
          metaSourceRow > 2000)
      )
        throw new Error('Meta source row must be a whole number from 1 to 2000.');
      const metaPublishedLabel = read('metaPublishedLabel').trim();
      if (metaPublishedLabel.length > 100) throw new Error('Meta date text is too long.');
      const metaGroupName = read('metaGroupName').trim();
      const metaGroupKey = read('metaGroupKey').trim();
      if (metaGroupName.length > 200 || metaGroupKey.length > 100)
        throw new Error('Meta group details are too long.');
      const fromUrl = facebookIds(sourceUrl);
      const groupFacebookId = read('groupId').trim() || fromUrl?.groupId || '';
      const postFacebookId = read('postId').trim() || fromUrl?.postId || '';
      if (groupFacebookId && !/^\d{1,40}$/.test(groupFacebookId))
        throw new Error(
          'Group ID must contain digits only. Format ID columns as text; scientific notation cannot be recovered.',
        );
      if (postFacebookId && !/^\d{1,40}$/.test(postFacebookId))
        throw new Error(
          'Post ID must contain digits only. Format ID columns as text; scientific notation cannot be recovered.',
        );
      if (
        fromUrl &&
        ((groupFacebookId && fromUrl.groupId !== groupFacebookId) ||
          (postFacebookId && fromUrl.postId !== postFacebookId))
      )
        throw new Error('The Facebook IDs do not match the post URL.');
      const groupName = read('group').trim();
      const groupReference = read('groupReference').trim();
      let group = allGroups.find(
        (item) =>
          item.companyId === company.id && (groupReference ? item.id === groupReference : false),
      );
      if (!group && groupFacebookId)
        group = allGroups.find(
          (item) => item.companyId === company.id && item.facebookId === groupFacebookId,
        );
      if (!group && groupName)
        group = allGroups.find(
          (item) =>
            item.companyId === company.id &&
            item.name.toLowerCase() === groupName.toLowerCase() &&
            (!groupFacebookId || !item.facebookId),
        );
      if (group?.deletedAt)
        throw new Error('This group is in Trash. Restore it before importing posts.');
      if (group && groupFacebookId && group.facebookId !== groupFacebookId)
        throw new Error(
          'This group has a different or missing Facebook ID. Update the group first.',
        );
      let candidateGroup: Group | undefined;
      if (!group && (groupName || groupFacebookId)) {
        candidateGroup = {
          id: `group-${crypto.randomUUID()}`,
          companyId: company.id,
          name: groupName || resolveFacebookGroupName(groupFacebookId),
          facebookId: groupFacebookId,
          category: read('category').trim(),
          notes: '',
        };
        group = candidateGroup;
      }
      const publishedAt = parseDate(read('posted'), 'Published at');
      if (publishedAt && Date.parse(publishedAt) > Date.now())
        throw new Error('Published at cannot be in the future.');
      if (
        !sourceUrl &&
        !canonicalPostUrl(group?.facebookId ?? '', postFacebookId) &&
        publicationStatus !== 'pending' &&
        metaSourceRow === undefined
      )
        throw new Error('Add a valid HTTPS post URL or both Facebook Group ID and Post ID.');
      const platform = (read('platform').trim().toLowerCase() || 'facebook') as Post['platform'];
      if (!['facebook', 'instagram', 'tiktok', 'linkedin'].includes(platform))
        throw new Error('Platform must be facebook, instagram, tiktok, or linkedin.');
      const productName = read('product').trim();
      const explicitProductId = read('productId').trim();
      const companyProducts = workspace.products.filter(
        (item) => !item.deletedAt && productCompanies.get(item.id)?.includes(company.id),
      );
      const matchingProducts = companyProducts.filter((item) => item.name.trim() === productName);
      const linkedProduct = explicitProductId
        ? workspace.products.find((item) => item.id === explicitProductId)
        : matchingProducts.length === 1
          ? matchingProducts[0]
          : undefined;
      if (explicitProductId && !linkedProduct) throw new Error('Product ID does not exist.');
      const explicitDestinationId = read('destinationId').trim();
      const destinationId =
        explicitDestinationId && group && explicitDestinationId === groupReference
          ? group.id
          : explicitDestinationId;
      if (
        destinationId &&
        destinationId !== group?.id &&
        !workspace.destinations?.some((item) => item.id === destinationId)
      )
        throw new Error('Destination ID does not exist.');
      let viewers: number | null = null;
      if (read('viewers').trim()) {
        const value = read('viewers').trim();
        if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value))
          throw new Error('Viewers must be a non-negative whole number.');
        viewers = Number(value.replaceAll(',', ''));
        if (!Number.isSafeInteger(viewers))
          throw new Error('Viewers is too large to store accurately.');
      } else if (read('metrics').trim()) {
        try {
          viewers = latestLegacyViewers(JSON.parse(read('metrics')));
        } catch {
          throw new Error('Metrics JSON could not be read.');
        }
      }
      let commentCount: number | null = null;
      if (read('comments').trim()) {
        const value = read('comments').trim();
        if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value))
          throw new Error('Comments must be a non-negative whole number.');
        commentCount = Number(value.replaceAll(',', ''));
        if (!Number.isSafeInteger(commentCount))
          throw new Error('Comments is too large to store accurately.');
      }
      const pinnedCell = read('pinned').trim().toLowerCase();
      if (pinnedCell && !['true', 'false', '1', '0', 'yes', 'no'].includes(pinnedCell))
        throw new Error('Pinned must be true or false.');
      const pinned = ['true', '1', 'yes'].includes(pinnedCell);
      const post: Post = {
        id: read('record').trim() || `post-${crypto.randomUUID()}`,
        companyId: company.id,
        groupId: group?.id ?? '',
        product: productName || linkedProduct?.name || '',
        ...(linkedProduct ? { productId: linkedProduct.id } : {}),
        ...(destinationId ? { destinationId } : {}),
        platform,
        publishedAt,
        facebookPostId: postFacebookId,
        url: canonicalPostUrl(groupFacebookId, postFacebookId) || sourceUrl,
        viewers,
        commentCount,
        pinned,
        ...(!publishedAt || publicationStatus === 'pending'
          ? { publicationStatus: 'pending' as const }
          : {}),
        ...(metaSourceRow === undefined ? {} : { metaSourceRow }),
        ...(metaPublishedLabel ? { metaPublishedLabel } : {}),
        ...(metaGroupName ? { metaGroupName } : {}),
        ...(metaGroupKey ? { metaGroupKey } : {}),
        color: read('color').trim() || company.color,
      };
      const candidateGroups = candidateGroup ? [...allGroups, candidateGroup] : allGroups;
      if (candidateGroup)
        identityContext.groupFacebookIds.set(candidateGroup.id, candidateGroup.facebookId);
      const keys = [`record:${post.id}`, ...postIdentityKeys(post, workspace, identityContext)];
      if (keys.some((key) => seen.has(key))) {
        result.skipped += 1;
        continue;
      }
      // Validate each candidate before adding it; invalid rows never create empty groups.
      if (workspace.posts.length + result.posts.length >= 50000)
        throw new Error('The workspace limit is 50,000 posts.');
      if (candidateGroup && allGroups.length >= 10000)
        throw new Error('The workspace limit is 10,000 groups.');
      validateWorkspace({
        version: 1,
        sample: false,
        companies: workspace.companies,
        products: workspace.products,
        groups: candidateGroups,
        destinations: workspace.destinations,
        posts: [post],
      });
      if (candidateGroup) {
        allGroups.push(candidateGroup);
        result.groups.push(candidateGroup);
      }
      result.posts.push(post);
      if (linkedProduct?.companyIds === undefined && post.productId) {
        const knownCompanies = productCompanies.get(post.productId) ?? [];
        if (!knownCompanies.includes(company.id))
          productCompanies.set(post.productId, [...knownCompanies, company.id]);
      }
      keys.forEach((key) => seen.add(key));
    } catch (error) {
      result.errors.push(
        `Row ${rowIndex + 1}: ${error instanceof Error ? error.message : 'Invalid data.'}`,
      );
    }
  }
  return result;
}
