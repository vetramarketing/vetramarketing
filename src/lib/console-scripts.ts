import { validCustomerDate } from './customer-data';

export const SCRIPT_PLATFORMS = ['facebook', 'instagram', 'tiktok'] as const;
export type ScriptPlatform = (typeof SCRIPT_PLATFORMS)[number];

export const SCRIPT_LIMITS = { title: 200, description: 5000, code: 100000 } as const;

/** Plain text saved for manual use. This application never evaluates the code. */
export interface ConsoleScript {
  id: string;
  /** Empty means shared across all companies. */
  companyId: string;
  title: string;
  platform: ScriptPlatform;
  description: string;
  code: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/** Empty editing state; a title and code must be supplied before saving. */
export function createConsoleScript(
  companyId: string,
  id: string,
  now = new Date(),
): ConsoleScript {
  const timestamp = now.toISOString();
  return {
    id,
    companyId,
    title: '',
    platform: 'facebook',
    description: '',
    code: '',
    pinned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, limit: number, required = false): string {
  if (
    typeof value !== 'string' ||
    value.length > limit ||
    (required && !value.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    throw new Error(`${label} is invalid.`);
  return value;
}

function identifier(value: unknown, label: string): string {
  const result = text(value, label, 100, true);
  if (
    !/^[A-Za-z0-9_.-]+$/.test(result) ||
    ['__proto__', 'constructor', 'prototype'].includes(result)
  )
    throw new Error(`${label} is invalid.`);
  return result;
}

function codeText(value: unknown): string {
  if (typeof value !== 'string' || value.length > SCRIPT_LIMITS.code || !value.trim())
    throw new Error('Script code is invalid.');
  return value;
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 40, true);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    !validCustomerDate(result.slice(0, 10)) ||
    !Number.isFinite(Date.parse(result))
  )
    throw new Error(`${label} must be a valid timestamp.`);
  return result;
}

/** Missing legacy collections initialize empty; malformed collections never silently disappear. */
export function validateConsoleScripts(input: unknown, companyIds: Set<string>): ConsoleScript[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 10000)
    throw new Error('Scripts must be a list of at most 10000 items.');
  const seen = new Set<string>();
  return input.map((value) => {
    const item = record(value, 'Script');
    const id = identifier(item.id, 'Script ID');
    if (seen.has(id)) throw new Error('Scripts contain duplicate IDs.');
    seen.add(id);
    const companyId = item.companyId === '' ? '' : identifier(item.companyId, 'Script company ID');
    if (companyId && !companyIds.has(companyId))
      throw new Error('A script references a missing company.');
    if (!SCRIPT_PLATFORMS.some((platform) => platform === item.platform))
      throw new Error('Script platform is invalid.');
    if (typeof item.pinned !== 'boolean') throw new Error('Script pin state is invalid.');
    // Code is deliberately not trimmed, parsed, rewritten, or executed.
    return {
      id,
      companyId,
      title: text(item.title, 'Script title', SCRIPT_LIMITS.title, true),
      platform: item.platform as ScriptPlatform,
      description: text(item.description, 'Script description', SCRIPT_LIMITS.description),
      code: codeText(item.code),
      pinned: item.pinned,
      createdAt: timestamp(item.createdAt, 'Script creation date'),
      updatedAt: timestamp(item.updatedAt, 'Script update date'),
      ...(item.deletedAt === undefined
        ? {}
        : { deletedAt: timestamp(item.deletedAt, 'Script deletion date') }),
    };
  });
}

/** Token matching includes code so a remembered selector or function can find a snippet. */
export function scriptMatchesQuery(script: ConsoleScript, query: string): boolean {
  const tokens = query.normalize('NFC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const searchable = [script.title, script.description, script.code, script.platform]
    .join('\n')
    .normalize('NFC')
    .toLocaleLowerCase();
  return tokens.every((token) => searchable.includes(token));
}
