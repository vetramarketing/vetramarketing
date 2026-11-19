import { Parser } from 'htmlparser2';
import { facebookGroupKeyFromText } from './facebook-group-link';
import type { Group, Workspace } from './types';

export const MAX_GROUP_HTML_BYTES = 10 * 1024 * 1024;
const MAX_GROUPS = 10000;
const STALE_PREVIEW = 'The group import preview is stale. Review the HTML again before saving.';

export interface GroupHtmlChange {
  kind: 'add' | 'update';
  key: string;
  name: string;
  url: string;
  existingId?: string;
  previousName?: string;
}

export interface GroupHtmlIssue {
  key?: string;
  name?: string;
  reason: string;
}

export interface GroupHtmlImportPreview {
  companyId: string;
  found: number;
  changes: GroupHtmlChange[];
  unchanged: number;
  issues: GroupHtmlIssue[];
}

const facebookHosts = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'mbasic.facebook.com',
]);
const navigationKeys = new Set([
  'feed',
  'discover',
  'joins',
  'create',
  'categories',
  'notifications',
  'your_groups',
  'membership',
  'admin',
]);
const actionLabel =
  /^(?:view group|visit group|join group|joined|manage group|ดูกลุ่ม|เข้าร่วมกลุ่ม|เข้าร่วมแล้ว|เยี่ยมชมกลุ่ม|จัดการกลุ่ม)$/i;
const ignoredElements = new Set(['script', 'style', 'template', 'noscript', 'svg']);
const normalizeName = (value: string) => value.replace(/\s+/g, ' ').trim();

function groupKey(href: string, allowPost = false): string | null {
  try {
    const url = new URL(href, 'https://www.facebook.com');
    if (
      url.protocol !== 'https:' ||
      !facebookHosts.has(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const pattern = allowPost
      ? /^\/groups\/([A-Za-z0-9._-]{1,80})(?:\/(?:posts|permalink)\/\d{1,40})?\/?$/
      : /^\/groups\/([A-Za-z0-9._-]{1,80})\/?$/;
    const match = pattern.exec(url.pathname);
    if (!match) return null;
    const key = match[1].toLowerCase();
    if (navigationKeys.has(key) || (/^\d+$/.test(key) && key.length > 40)) return null;
    // These query parameters identify a post, not a group card.
    if (
      !allowPost &&
      (url.searchParams.has('multi_permalinks') || url.searchParams.has('story_fbid'))
    )
      return null;
    return key;
  } catch {
    return null;
  }
}

interface SourceGroup {
  key: string;
  names: Set<string>;
}

/** Parse text without attaching HTML to a document or loading any of its resources. */
function parseGroupLinks(source: string): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  type Anchor = { key: string; text: string; action: boolean };
  const stack: { ignored: boolean; anchor?: Anchor; ownAnchor?: Anchor }[] = [];
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        const parent = stack.at(-1);
        const ignored = Boolean(
          parent?.ignored ||
          ignoredElements.has(name) ||
          'hidden' in attributes ||
          attributes['aria-hidden'] === 'true',
        );
        let ownAnchor: Anchor | undefined;
        if (!ignored && name === 'a' && attributes.href) {
          const key = groupKey(attributes.href);
          if (key) {
            ownAnchor = {
              key,
              text: '',
              action: actionLabel.test(normalizeName(attributes['aria-label'] ?? '')),
            };
          }
        }
        const anchor = name === 'a' ? ownAnchor : parent?.anchor;
        if (!ignored && name === 'br' && anchor) anchor.text += ' ';
        stack.push({ ignored, anchor, ownAnchor });
      },
      ontext(text) {
        const frame = stack.at(-1);
        if (!frame?.ignored && frame?.anchor) frame.anchor.text += text;
      },
      onclosetag() {
        const anchor = stack.pop()?.ownAnchor;
        if (!anchor) return;
        let group = groups.get(anchor.key);
        if (!group) {
          if (groups.size >= MAX_GROUPS)
            throw new Error('Group HTML has too many groups (10,000 maximum).');
          group = { key: anchor.key, names: new Set() };
          groups.set(anchor.key, group);
        }
        const name = normalizeName(anchor.text);
        if (name && !anchor.action && !actionLabel.test(name)) group.names.add(name);
      },
    },
    { decodeEntities: true },
  );
  parser.end(source);
  return [...groups.values()];
}

function companyGroupIndex(workspace: Workspace, companyId: string): Map<string, Group[]> {
  const index = new Map<string, Group[]>();
  const companyGroups = new Map(
    workspace.groups
      .filter((group) => group.companyId === companyId)
      .map((group) => [group.id, group]),
  );
  const add = (key: string | null, group: Group) => {
    if (!key) return;
    // A saved numeric ID is authoritative: two different numeric IDs cannot be aliases.
    if (/^\d{1,40}$/.test(group.facebookId) && /^\d+$/.test(key) && key !== group.facebookId)
      return;
    const matches = index.get(key) ?? [];
    if (!matches.some((match) => match.id === group.id)) matches.push(group);
    index.set(key, matches);
  };
  for (const group of companyGroups.values()) {
    if (/^\d{1,40}$/.test(group.facebookId)) add(group.facebookId, group);
    const noteKey = facebookGroupKeyFromText(group.notes);
    if (noteKey) add(groupKey(`https://www.facebook.com/groups/${noteKey}/`), group);
  }
  for (const post of workspace.posts) {
    const group = companyGroups.get(post.groupId);
    if (group && post.companyId === companyId) add(groupKey(post.url, true), group);
  }
  return index;
}

function requireCompany(workspace: Workspace, companyId: string) {
  if (!workspace.companies.some((company) => company.id === companyId))
    throw new Error('Choose an existing company before importing groups.');
}

export function previewGroupHtmlImport(
  source: string,
  workspace: Workspace,
  companyId: string,
): GroupHtmlImportPreview {
  requireCompany(workspace, companyId);
  if (!source.trim()) throw new Error('Paste the Facebook group outerHTML first.');
  if (
    source.length > MAX_GROUP_HTML_BYTES ||
    new TextEncoder().encode(source).length > MAX_GROUP_HTML_BYTES
  )
    throw new Error('Group HTML is too large (10 MB maximum).');
  const sourceGroups = parseGroupLinks(source);
  if (!sourceGroups.length)
    throw new Error('No Facebook group links were found. Paste the joined-groups outerHTML.');
  const index = companyGroupIndex(workspace, companyId);
  const preview: GroupHtmlImportPreview = {
    companyId,
    found: sourceGroups.length,
    changes: [],
    unchanged: 0,
    issues: [],
  };
  const matched = new Map<string, { group: Group; entries: { key: string; name: string }[] }>();
  const conflictedTargets = new Set<string>();
  let remaining = Math.max(0, MAX_GROUPS - workspace.groups.length);
  for (const sourceGroup of sourceGroups) {
    const { key, names } = sourceGroup;
    const name = [...names][0] ?? '';
    const issue = (reason: string) => preview.issues.push({ key, name, reason });
    if (!names.size) {
      issue('No group name was found for this link.');
    } else if (names.size > 1) {
      issue('Conflicting group names were found for this link.');
      for (const group of index.get(key) ?? []) conflictedTargets.add(group.id);
    } else if (name.length > 200) {
      issue('Group name is longer than 200 characters.');
    } else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(name)) {
      issue('Group name contains unsupported control characters.');
    } else {
      const matches = index.get(key) ?? [];
      if (matches.length > 1) {
        issue('More than one saved group matches this link.');
      } else if (matches[0]?.deletedAt) {
        issue('This group is in Trash. Restore it before importing.');
      } else if (matches[0]) {
        const group = matches[0];
        const target = matched.get(group.id) ?? { group, entries: [] };
        target.entries.push({ key, name });
        matched.set(group.id, target);
      } else if (!remaining) {
        issue('Group catalog is full (10,000 maximum).');
      } else {
        remaining -= 1;
        preview.changes.push({
          kind: 'add',
          key,
          name,
          url: `https://www.facebook.com/groups/${key}/`,
        });
      }
    }
  }
  for (const { group, entries } of matched.values()) {
    if (conflictedTargets.has(group.id) || new Set(entries.map(({ name }) => name)).size > 1) {
      for (const entry of entries)
        preview.issues.push({
          ...entry,
          reason: 'Different source links match the same saved group with conflicting names.',
        });
      continue;
    }
    const { key, name } = entries[0];
    if (name === group.name) {
      preview.unchanged += 1;
    } else {
      preview.changes.push({
        kind: 'update',
        key,
        name,
        url: `https://www.facebook.com/groups/${key}/`,
        existingId: group.id,
        previousName: group.name,
      });
    }
  }
  return preview;
}

/** Apply only reviewed additions and names; saved notes, IDs, relationships and Trash stay intact. */
export function applyGroupHtmlImport(
  workspace: Workspace,
  preview: GroupHtmlImportPreview,
): Workspace {
  requireCompany(workspace, preview.companyId);
  const index = companyGroupIndex(workspace, preview.companyId);
  const additions: Group[] = [];
  const names = new Map<string, string>();
  const seenKeys = new Set<string>();
  const existingIds = new Set(workspace.groups.map((group) => group.id));
  for (const change of preview.changes) {
    if (
      groupKey(change.url) !== change.key ||
      !change.name ||
      change.name !== normalizeName(change.name) ||
      change.name.length > 200 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(change.name) ||
      seenKeys.has(change.key)
    )
      throw new Error(STALE_PREVIEW);
    seenKeys.add(change.key);
    const matches = index.get(change.key) ?? [];
    if (matches.length > 1 || matches[0]?.deletedAt) throw new Error(STALE_PREVIEW);
    if (change.kind === 'update') {
      const group = matches[0];
      if (
        !group ||
        group.id !== change.existingId ||
        (group.name !== change.previousName && group.name !== change.name)
      )
        throw new Error(STALE_PREVIEW);
      if (names.has(group.id) && names.get(group.id) !== change.name)
        throw new Error(STALE_PREVIEW);
      if (group.name !== change.name) names.set(group.id, change.name);
    } else if (change.kind === 'add') {
      if (matches[0]) {
        if (matches[0].name !== change.name) throw new Error(STALE_PREVIEW);
        continue;
      }
      if (workspace.groups.length + additions.length >= MAX_GROUPS)
        throw new Error('Group catalog is full (10,000 maximum).');
      const id = crypto.randomUUID();
      if (existingIds.has(id)) throw new Error(STALE_PREVIEW);
      existingIds.add(id);
      additions.push({
        id,
        companyId: preview.companyId,
        name: change.name,
        facebookId: /^\d+$/.test(change.key) ? change.key : '',
        category: '',
        notes: change.url,
      });
    } else throw new Error(STALE_PREVIEW);
  }
  if (!additions.length && !names.size) return workspace;
  return {
    ...workspace,
    groups: [
      ...workspace.groups.map((group) =>
        names.has(group.id) ? { ...group, name: names.get(group.id)! } : group,
      ),
      ...additions,
    ],
  };
}
