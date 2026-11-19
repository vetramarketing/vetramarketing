import type { Destination, Group, Post, Product, Workspace } from './types';
import { validSortOrder } from './catalog';
import { validateCloudinaryImage } from './cloudinary-media';
import { BUNDLED_CATALOG_IMAGES } from './catalog-images';
import { validateConsoleScripts } from './console-scripts';
import {
  defaultShippingSettings,
  validateOrders,
  validateOrderSequences,
  validateShippingSettings,
} from './orders';
import { inferPublishingDestination, inferredDestinationId } from './publishing-destination';
import {
  createDefaultBusinessTypes,
  validateBusinessTypes,
  validateCustomers,
} from './customer-data';

const DAY = 86_400_000;
const MAX_COUNT = Number.MAX_SAFE_INTEGER;
const platforms = new Set(['facebook', 'instagram', 'tiktok', 'linkedin']);
const statuses = new Set(['draft', 'planned', 'published']);
const colorPattern = /^#[0-9a-f]{6}$/i;
const numericIdPattern = /^\d{1,40}$/;

/** Facebook identifiers stay strings; never coerce them to JavaScript numbers. */
export function canonicalPostUrl(groupFacebookId: string, postId: string): string {
  if (!numericIdPattern.test(groupFacebookId) || !numericIdPattern.test(postId)) return '';
  return `https://www.facebook.com/groups/${groupFacebookId}/posts/${postId}/`;
}

/** Calendar dates and reporting days are interpreted in the project's ICT timezone. */
export function reportingDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function latestViewers(post: Post): number {
  return post.viewers ?? 0;
}

export function createEmptyWorkspace(): Workspace {
  return {
    version: 1,
    sample: false,
    businessTypes: createDefaultBusinessTypes(),
    customers: [],
    scripts: [],
    orders: [],
    orderSequences: {},
    shippingSettings: defaultShippingSettings(),
    companies: [
      {
        id: 'vetra',
        name: 'VETRA STORE',
        businessTypeId: 'retail',
        logoImageUrl: '',
        ownerName: '',
        sortOrder: 0,
        initials: 'V',
        color: '#263b4b',
        description: 'A thoughtful everyday.',
      },
    ],
    products: [],
    groups: [],
    destinations: [],
    posts: [],
  };
}

export function createSampleWorkspace(now = new Date()): Workspace {
  const at = (offset: number, hour = 3) => {
    const date = new Date(`${reportingDate(now)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    date.setUTCHours(hour, 0, 0, 0);
    return date.toISOString();
  };
  const companies = [
    {
      id: 'vetra',
      name: 'VETRA STORE',
      businessTypeId: 'retail',
      logoImageUrl: '',
      ownerName: '',
      sortOrder: 0,
      initials: 'V',
      color: '#263b4b',
      description: 'Good things, thoughtfully shared.',
    },
    {
      id: 'olive',
      name: 'OLIVE Studio',
      businessTypeId: 'retail',
      logoImageUrl: '',
      ownerName: '',
      sortOrder: 1,
      initials: 'O',
      color: '#677253',
      description: 'Sample brand · Objects for a slower everyday.',
    },
    {
      id: 'kin',
      name: 'KIN Living',
      businessTypeId: 'retail',
      logoImageUrl: '',
      ownerName: '',
      sortOrder: 2,
      initials: 'K',
      color: '#b97658',
      description: 'Sample brand · A little warmth for your home.',
    },
  ];
  const groups: Group[] = [
    {
      id: 'g-living',
      companyId: 'vetra',
      name: 'แต่งบ้านให้น่าอยู่',
      facebookId: '',
      category: 'Home & lifestyle',
      notes: 'Sample group. Add a real Group ID to create links.',
    },
    {
      id: 'g-coffee',
      companyId: 'vetra',
      name: 'Coffee & Slow Mornings',
      facebookId: '',
      category: 'Food & drink',
      notes: 'Sample group for campaign planning.',
    },
    {
      id: 'g-finds',
      companyId: 'vetra',
      name: 'ของดีบอกต่อ • Everyday Finds',
      facebookId: '',
      category: 'Shopping',
      notes: 'Sample group. Check community rules before posting.',
    },
    {
      id: 'g-craft',
      companyId: 'olive',
      name: 'The Thoughtful Home',
      facebookId: '',
      category: 'Design & craft',
      notes: 'Sample group.',
    },
    {
      id: 'g-plant',
      companyId: 'olive',
      name: 'มุมเล็ก ๆ สีเขียว',
      facebookId: '',
      category: 'Home & lifestyle',
      notes: 'Sample group.',
    },
    {
      id: 'g-space',
      companyId: 'kin',
      name: 'Small Space, Good Living',
      facebookId: '',
      category: 'Home & lifestyle',
      notes: 'Sample group.',
    },
  ];
  const ideas: {
    title: string;
    content: string;
    product: string;
    groupId: string;
    age: number;
    total: number;
    status?: Post['status'];
    platform?: Post['platform'];
  }[] = [
    {
      title: 'A slower start, a sweeter morning.',
      content:
        'เติมความละมุนให้เช้าวันใหม่ ☀️\nกาแฟแก้วโปรด น้ำผึ้งเล็กน้อย และเวลาที่ได้อยู่กับตัวเอง\n\nSample campaign copy — ready for your own product details.',
      product: 'Coffee Blossom Honey',
      groupId: 'g-coffee',
      age: 13,
      total: 2840,
    },
    {
      title: 'Little things. A better everyday.',
      content: 'สิ่งเล็ก ๆ ที่ทำให้ทุกวันพิเศษขึ้น\nเก็บไอเดียมุมโปรดในบ้าน แล้วมาแบ่งปันกัน',
      product: 'Everyday collection',
      groupId: 'g-living',
      age: 11,
      total: 1960,
    },
    {
      title: 'Your afternoon ritual, reimagined.',
      content:
        'พักจากวันที่เร่งรีบ แล้วให้เวลาตัวเองสักนิด\nWhat does your perfect afternoon look like?',
      product: 'Coffee Blossom Honey',
      groupId: 'g-finds',
      age: 9,
      total: 1750,
    },
    {
      title: 'Made for the quiet moments.',
      content:
        'A favourite corner. Soft light. Something made with care.\n\nSample editorial post for OLIVE Studio.',
      product: 'Studio essentials',
      groupId: 'g-craft',
      age: 8,
      total: 1420,
    },
    {
      title: 'Bring a little outside in.',
      content: 'มุมสีเขียวเล็ก ๆ ช่วยเติมชีวิตให้บ้าน\nเริ่มจากต้นไม้หนึ่งต้น และพื้นที่ที่คุณรัก',
      product: 'Green corner',
      groupId: 'g-plant',
      age: 6,
      total: 930,
    },
    {
      title: 'Small spaces, lovely possibilities.',
      content:
        'You do not need a bigger room to make room for something good.\n\nSample inspiration from KIN Living.',
      product: 'Home edit',
      groupId: 'g-space',
      age: 4,
      total: 1120,
    },
    {
      title: 'เรื่องดี ๆ เริ่มต้นที่บ้าน',
      content: 'มุมโปรดของคุณอยู่ตรงไหน?\nชวนเก็บไอเดียง่าย ๆ ให้บ้านน่าอยู่ขึ้นในแบบของเรา',
      product: 'Everyday collection',
      groupId: 'g-living',
      age: 2,
      total: 780,
    },
    {
      title: 'The weekend, poured slowly.',
      content:
        'A gentle reminder to make a little space for yourself this weekend.\n\nAdd approved product details before sharing.',
      product: 'Coffee Blossom Honey',
      groupId: 'g-coffee',
      age: -1,
      total: 0,
      status: 'planned',
    },
    {
      title: 'A thoughtful gift, just because.',
      content:
        'ไม่ต้องรอโอกาสพิเศษ ก็ส่งต่อความใส่ใจได้\n\nDraft concept — add product, pricing, and ordering details.',
      product: 'Gift edit',
      groupId: 'g-finds',
      age: -2,
      total: 0,
      status: 'planned',
    },
    {
      title: 'Find your softer side.',
      content: 'Natural tones. Thoughtful details. A place to pause.\n\nSample planned content.',
      product: 'Studio essentials',
      groupId: 'g-craft',
      age: -3,
      total: 0,
      status: 'planned',
      platform: 'instagram',
    },
    {
      title: 'A new story for your favourite corner.',
      content:
        'Draft idea: a simple before-and-after styling story.\nAdd your own photographs and approved product information.',
      product: 'Home edit',
      groupId: 'g-space',
      age: -4,
      total: 0,
      status: 'draft',
    },
    {
      title: 'Three ways to brighten your morning.',
      content: 'ไอเดียโพสต์: 3 วิธีเริ่มวันให้สดใส\nเลือกภาพและตรวจสอบรายละเอียดสินค้าก่อนเผยแพร่',
      product: 'Coffee Blossom Honey',
      groupId: 'g-coffee',
      age: -5,
      total: 0,
      status: 'draft',
    },
  ];
  const posts: Post[] = ideas.map((idea, index) => {
    const group = groups.find((entry) => entry.id === idea.groupId)!;
    const company = companies.find((entry) => entry.id === group.companyId)!;
    const status = idea.status ?? 'published';
    return {
      id: `sample-${index + 1}`,
      companyId: company.id,
      groupId: group.id,
      title: idea.title,
      content: idea.content,
      product: idea.product,
      platform: idea.platform ?? 'facebook',
      status,
      scheduledAt: status === 'planned' ? at(-idea.age) : '',
      publishedAt: status === 'published' ? at(-idea.age, 1) : '',
      facebookPostId: '',
      url: '',
      viewers: status === 'published' ? idea.total : null,
      color: company.color,
    };
  });
  return {
    version: 1,
    companies,
    businessTypes: createDefaultBusinessTypes(),
    customers: [],
    products: [],
    groups,
    posts,
    sample: true,
  };
}

/** Group deletion does not delete posts. Restoration remains possible for 30 days. */
export function pruneTrash(workspace: Workspace, now = new Date()): Workspace {
  const expired = (date?: string) => Boolean(date && now.getTime() - Date.parse(date) >= 30 * DAY);
  const expiredProductIds = new Set(
    workspace.products.filter((product) => expired(product.deletedAt)).map((product) => product.id),
  );
  const expiredGroups = new Map(
    workspace.groups.filter((group) => expired(group.deletedAt)).map((group) => [group.id, group]),
  );
  const expiredDestinationGroups = new Map(
    (workspace.destinations ?? []).flatMap((destination) => {
      const group = expiredGroups.get(destination.groupId ?? '');
      return group ? [[destination.id, group] as const] : [];
    }),
  );
  const referencedDestinationIds = new Set(workspace.posts.map((post) => post.destinationId));
  return {
    ...workspace,
    scripts: (workspace.scripts ?? []).filter((script) => !expired(script.deletedAt)),
    orders: (workspace.orders ?? []).filter((order) => !expired(order.deletedAt)),
    orderSequences: validateOrderSequences(workspace.orderSequences, workspace.orders ?? []),
    customers: workspace.customers
      .filter((customer) => !expired(customer.deletedAt))
      .map((customer) =>
        customer.productIds?.some((id) => expiredProductIds.has(id))
          ? {
              ...customer,
              productIds: customer.productIds.filter((id) => !expiredProductIds.has(id)),
              ...(customer.productQuantities === undefined
                ? {}
                : {
                    productQuantities: Object.fromEntries(
                      Object.entries(customer.productQuantities).filter(
                        ([id]) => !expiredProductIds.has(id),
                      ),
                    ),
                  }),
            }
          : customer,
      ),
    products: workspace.products.filter((product) => !expired(product.deletedAt)),
    groups: workspace.groups.filter((group) => !expired(group.deletedAt)),
    destinations: workspace.destinations?.filter(
      (destination) =>
        (!expired(destination.deletedAt) || referencedDestinationIds.has(destination.id)) &&
        !(destination.groupId && expiredGroups.has(destination.groupId)),
    ),
    posts: workspace.posts
      .filter((post) => !expired(post.deletedAt))
      .map((post) => {
        // Older posts may refer to a group only through its destination ID.
        // Unlink both forms before the expired destination is removed.
        const group =
          expiredGroups.get(post.groupId) ??
          expiredGroups.get(post.destinationId ?? '') ??
          expiredDestinationGroups.get(post.destinationId ?? '');
        return {
          ...post,
          ...(expiredProductIds.has(post.productId ?? '') ? { productId: undefined } : {}),
          ...(group
            ? {
                groupId: '',
                destinationId: undefined,
                url: post.url || canonicalPostUrl(group.facebookId, post.facebookPostId),
              }
            : {}),
        };
      }),
  };
}

function object(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error(`${label} must be an object.`);
  return input as Record<string, unknown>;
}

function string(input: unknown, label: string, max = 200, required = false): string {
  if (
    typeof input !== 'string' ||
    input.length > max ||
    (required && !input.trim()) ||
    /\u0000/.test(input)
  )
    throw new Error(`${label} is missing or invalid.`);
  return input;
}

function identifier(input: unknown, label: string): string {
  const value = string(input, label, 100, true);
  if (!/^[a-zA-Z0-9_.-]+$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value))
    throw new Error(`${label} is invalid.`);
  return value;
}

export function validDate(value: string): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (
    year < 1970 ||
    year > 2200 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate()
  )
    return false;
  return !value.includes('T') || Number(value.slice(11, 13)) < 24;
}

function date(input: unknown, label: string, optional = false): string {
  const value = string(input, label, 40);
  if ((optional && value === '') || validDate(value)) return value;
  throw new Error(`${label} must be a valid date.`);
}

function color(input: unknown, label: string): string {
  const value = string(input, label, 7);
  if (!colorPattern.test(value)) throw new Error(`${label} must be a six-digit hex color.`);
  return value;
}

function facebookId(input: unknown, label: string): string {
  const value = string(input, label, 40);
  if (value && !numericIdPattern.test(value)) throw new Error(`${label} must contain digits only.`);
  return value;
}

export function safePostUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      Boolean(url.hostname) &&
      !/[\u0000-\u0020\u007f]/.test(value)
    );
  } catch {
    return false;
  }
}

function array(input: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(input) || input.length > max)
    throw new Error(`${label} must be a list with at most ${max.toLocaleString()} items.`);
  return input;
}

function unique(values: { id: string }[], label: string) {
  if (new Set(values.map((value) => value.id)).size !== values.length)
    throw new Error(`${label} contains duplicate IDs.`);
}

function imageUrl(input: unknown, label: string): string {
  const value = string(input, label, 2048);
  if (!safeCatalogImageUrl(value))
    throw new Error(`${label} must be an HTTPS link, an approved bundled image, or empty.`);
  return value;
}

export function safeCatalogImageUrl(value: string): boolean {
  return BUNDLED_CATALOG_IMAGES.includes(value) || safePostUrl(value);
}

function sortOrder(input: unknown): number {
  if (!validSortOrder(input))
    throw new Error('Sort order must be a whole number from 0 to 1,000,000.');
  return input;
}

/** Validate backups and local storage before data is trusted by the interface. */
export function validateWorkspace(input: unknown): Workspace {
  const raw = object(input, 'Workspace');
  if (raw.version !== 1 || typeof raw.sample !== 'boolean')
    throw new Error('This workspace format is not supported.');
  const businessTypes = validateBusinessTypes(
    raw.businessTypes === undefined ? createDefaultBusinessTypes() : raw.businessTypes,
  );
  const businessTypeIds = new Set(businessTypes.map((type) => type.id));
  const companies = array(raw.companies, 'Companies', 100).map((input) => {
    const item = object(input, 'Company');
    const logoImageUrl = imageUrl(item.logoImageUrl, 'Company logo URL');
    const businessTypeId = identifier(
      item.businessTypeId === undefined ? 'retail' : item.businessTypeId,
      'Company business type ID',
    );
    if (!businessTypeIds.has(businessTypeId))
      throw new Error('A company references a missing business type.');
    return {
      id: identifier(item.id, 'Company ID'),
      name: string(item.name, 'Company name', 100, true),
      businessTypeId,
      logoImageUrl,
      ...(item.logoAsset === undefined
        ? {}
        : { logoAsset: validateCloudinaryImage(item.logoAsset, logoImageUrl) }),
      ownerName: string(item.ownerName, 'Owner name', 100),
      sortOrder: sortOrder(item.sortOrder),
      initials: string(item.initials, 'Company initials', 5, true),
      color: color(item.color, 'Company color'),
      description: string(item.description, 'Company description', 1000),
    };
  });
  if (!companies.length) throw new Error('A workspace needs at least one company.');
  unique(companies, 'Companies');
  const companyIds = new Set(companies.map((company) => company.id));
  const products: Product[] = array(raw.products, 'Products', 10000).map((input) => {
    const item = object(input, 'Product');
    const productImageUrl = imageUrl(item.imageUrl, 'Product image URL');
    const productCompanyIds =
      item.companyIds === undefined
        ? undefined
        : array(item.companyIds, 'Product companies', 100).map((value) => {
            const companyId = identifier(value, 'Product company ID');
            if (!companyIds.has(companyId))
              throw new Error('A product references a missing company.');
            return companyId;
          });
    if (productCompanyIds && !productCompanyIds.length)
      throw new Error('Product companies must include at least one company.');
    if (productCompanyIds && new Set(productCompanyIds).size !== productCompanyIds.length)
      throw new Error('Product companies contain duplicate IDs.');
    return {
      id: identifier(item.id, 'Product ID'),
      name: string(item.name, 'Product name', 200, true),
      imageUrl: productImageUrl,
      ...(item.imageAsset === undefined
        ? {}
        : { imageAsset: validateCloudinaryImage(item.imageAsset, productImageUrl) }),
      ...(productCompanyIds === undefined ? {} : { companyIds: productCompanyIds }),
      sortOrder: sortOrder(item.sortOrder),
      ...(item.deletedAt === undefined
        ? {}
        : { deletedAt: date(item.deletedAt, 'Product deletion date') }),
    };
  });
  unique(products, 'Products');
  const customers = validateCustomers(
    raw.customers === undefined ? [] : raw.customers,
    companies,
    businessTypes,
    products,
  );
  const groups: Group[] = array(raw.groups, 'Groups', 10000).map((input) => {
    const item = object(input, 'Group');
    const companyId = identifier(item.companyId, 'Group company ID');
    if (!companyIds.has(companyId)) throw new Error('A group references a missing company.');
    return {
      id: identifier(item.id, 'Group ID'),
      companyId,
      name: string(item.name, 'Group name', 200, true),
      facebookId: facebookId(item.facebookId, 'Facebook group ID'),
      category: string(item.category, 'Group category', 100),
      notes: string(item.notes, 'Group notes', 2000),
      ...(item.deletedAt === undefined
        ? {}
        : { deletedAt: date(item.deletedAt, 'Group deletion date') }),
    };
  });
  unique(groups, 'Groups');
  const groupLookup = new Map(groups.map((group) => [group.id, group]));
  const destinations: Destination[] = array(raw.destinations ?? [], 'Destinations', 15000).map(
    (input) => {
      const item = object(input, 'Destination');
      const companyId = identifier(item.companyId, 'Destination company ID');
      if (!companyIds.has(companyId))
        throw new Error('A destination references a missing company.');
      const platform = string(item.platform, 'Destination platform');
      const kind = string(item.kind, 'Destination kind');
      if (!platforms.has(platform) || !['group', 'page', 'account'].includes(kind))
        throw new Error('A destination has an unsupported platform or kind.');
      const groupId =
        item.groupId === undefined ? undefined : identifier(item.groupId, 'Destination group ID');
      if (groupId && (kind !== 'group' || groupLookup.get(groupId)?.companyId !== companyId))
        throw new Error('A destination references a missing group.');
      return {
        id: identifier(item.id, 'Destination ID'),
        companyId,
        platform: platform as Destination['platform'],
        kind: kind as Destination['kind'],
        externalId: string(item.externalId, 'Destination external ID', 200),
        name: string(item.name, 'Destination name', 200, true),
        ...(groupId ? { groupId } : {}),
        ...(item.deletedAt === undefined
          ? {}
          : { deletedAt: date(item.deletedAt, 'Destination deletion date') }),
      };
    },
  );
  unique(destinations, 'Destinations');
  const destinationIndex = new Map(
    destinations.map((destination, index) => [destination.id, index]),
  );
  for (const group of groups) {
    const index = destinationIndex.get(group.id);
    if (
      index !== undefined &&
      (destinations[index].kind !== 'group' || destinations[index].groupId !== group.id)
    )
      throw new Error('A destination ID conflicts with a group.');
    const destination: Destination = {
      id: group.id,
      companyId: group.companyId,
      platform: 'facebook',
      kind: 'group',
      externalId: group.facebookId,
      name: group.name,
      groupId: group.id,
      ...(group.deletedAt ? { deletedAt: group.deletedAt } : {}),
    };
    if (index !== undefined) destinations[index] = destination;
    else {
      destinationIndex.set(group.id, destinations.length);
      destinations.push(destination);
    }
  }
  const naturalKey = (companyId: string, platform: string, kind: string, externalId: string) =>
    JSON.stringify([companyId, platform, kind, externalId]);
  const inferredDestinationLookup = new Map<string, Destination>();
  for (const destination of destinations) {
    const key = naturalKey(
      destination.companyId,
      destination.platform,
      destination.kind,
      destination.externalId,
    );
    if (!inferredDestinationLookup.has(key)) inferredDestinationLookup.set(key, destination);
  }
  const rawPosts = array(raw.posts, 'Posts', 50000);
  for (const input of rawPosts) {
    const item = object(input, 'Post');
    if (
      item.groupId ||
      item.destinationId ||
      typeof item.url !== 'string' ||
      typeof item.platform !== 'string' ||
      typeof item.companyId !== 'string'
    )
      continue;
    const inferred = inferPublishingDestination(item.platform as Post['platform'], item.url);
    if (!inferred) continue;
    const key = naturalKey(item.companyId, inferred.platform, inferred.kind, inferred.externalId);
    if (inferredDestinationLookup.has(key)) continue;
    if (destinations.length >= 15000)
      throw new Error('The workspace limit is 15,000 destinations.');
    const id = inferredDestinationId(item.companyId, inferred);
    if (destinationIndex.has(id))
      throw new Error('A destination ID conflicts with an existing destination.');
    const destination = { id, companyId: item.companyId, ...inferred };
    destinationIndex.set(id, destinations.length);
    destinations.push(destination);
    inferredDestinationLookup.set(key, destination);
  }
  const destinationLookup = new Map(
    destinations.map((destination) => [destination.id, destination]),
  );
  const productLookup = new Map(products.map((product) => [product.id, product]));
  const posts: Post[] = rawPosts.map((input) => {
    const item = object(input, 'Post');
    const companyId = identifier(item.companyId, 'Post company ID');
    if (!companyIds.has(companyId)) throw new Error('A post references a missing company.');
    const groupId = string(item.groupId, 'Post group ID', 100);
    if (groupId && groupLookup.get(groupId)?.companyId !== companyId)
      throw new Error('A post references a missing group or a group from another company.');
    const productId =
      item.productId === undefined ? undefined : identifier(item.productId, 'Post product ID');
    if (productId && !productLookup.has(productId))
      throw new Error('A post references a missing product.');
    const inferred =
      !groupId && typeof item.url === 'string' && typeof item.platform === 'string'
        ? inferPublishingDestination(item.platform as Post['platform'], item.url)
        : null;
    const inferredDestination =
      inferred &&
      inferredDestinationLookup.get(
        naturalKey(companyId, inferred.platform, inferred.kind, inferred.externalId),
      );
    const destinationId =
      item.destinationId === undefined
        ? item.platform === 'facebook'
          ? groupId || inferredDestination?.id
          : inferredDestination?.id
        : identifier(item.destinationId, 'Post destination ID');
    const destination = destinationId ? destinationLookup.get(destinationId) : undefined;
    if (
      destinationId &&
      (!destination ||
        destination.companyId !== companyId ||
        destination.platform !== item.platform ||
        (groupId && destination.groupId !== groupId))
    )
      throw new Error('A post references a missing or mismatched destination.');
    if (
      !groupId &&
      inferred &&
      destination &&
      (destination.kind !== inferred.kind || destination.externalId !== inferred.externalId)
    )
      throw new Error('A post destination does not match its URL.');
    const platform = string(item.platform, 'Platform');
    const status = item.status === undefined ? 'published' : string(item.status, 'Status');
    if (!platforms.has(platform) || !statuses.has(status))
      throw new Error('A post has an unsupported platform or status.');
    if (!raw.sample && status !== 'published')
      throw new Error('Only published posts can be saved in this workspace.');
    const url = string(item.url, 'Post URL', 2048);
    if (!safePostUrl(url)) throw new Error('Post URLs must be valid HTTPS links.');
    const scheduledAt =
      item.scheduledAt === undefined ? '' : date(item.scheduledAt, 'Scheduled date', true);
    const publishedAt = date(item.publishedAt, 'Published date', true);
    const publicationStatus =
      item.publicationStatus === undefined
        ? undefined
        : string(item.publicationStatus, 'Publication status');
    if (publicationStatus !== undefined && !['published', 'pending'].includes(publicationStatus))
      throw new Error('Publication status must be published or pending.');
    const metaSourceRow = item.metaSourceRow;
    if (
      metaSourceRow !== undefined &&
      (typeof metaSourceRow !== 'number' ||
        !Number.isInteger(metaSourceRow) ||
        metaSourceRow < 1 ||
        metaSourceRow > 2000)
    )
      throw new Error('Meta source row must be a whole number from 1 to 2,000.');
    const metaPublishedLabel =
      item.metaPublishedLabel === undefined
        ? undefined
        : string(item.metaPublishedLabel, 'Meta publication label', 100, true);
    const metaGroupName =
      item.metaGroupName === undefined
        ? undefined
        : string(item.metaGroupName, 'Meta group name', 200, true);
    const metaGroupKey =
      item.metaGroupKey === undefined
        ? undefined
        : string(item.metaGroupKey, 'Meta group key', 100, true);
    if (metaGroupKey !== undefined && !/^[A-Za-z0-9._-]{2,80}$/.test(metaGroupKey))
      throw new Error('Meta group key is invalid.');
    if (
      metaSourceRow === undefined &&
      (metaPublishedLabel !== undefined ||
        metaGroupName !== undefined ||
        metaGroupKey !== undefined)
    )
      throw new Error('Meta source details need a source row.');
    if (status === 'planned' && !scheduledAt)
      throw new Error('Planned posts need a scheduled date.');
    const viewers = item.viewers;
    if (
      viewers !== null &&
      (typeof viewers !== 'number' ||
        !Number.isSafeInteger(viewers) ||
        viewers < 0 ||
        viewers > MAX_COUNT)
    )
      throw new Error('Viewers must be a non-negative safe whole number or empty.');
    if (viewers !== null && status !== 'published')
      throw new Error('Viewers belong to published posts.');
    const commentCount = item.commentCount === undefined ? null : item.commentCount;
    if (
      commentCount !== null &&
      (typeof commentCount !== 'number' ||
        !Number.isSafeInteger(commentCount) ||
        commentCount < 0 ||
        commentCount > MAX_COUNT)
    )
      throw new Error('Comments must be a non-negative safe whole number or empty.');
    if (item.pinned !== undefined && typeof item.pinned !== 'boolean')
      throw new Error('Pinned must be true or false.');
    return {
      id: identifier(item.id, 'Post ID'),
      companyId,
      groupId,
      product: string(item.product, 'Product', 200),
      ...(productId ? { productId } : {}),
      ...(destinationId ? { destinationId } : {}),
      platform: platform as Post['platform'],
      ...(raw.sample
        ? {
            title: string(item.title, 'Post title', 200, true),
            content: string(item.content, 'Post content', 20000),
            status: status as Post['status'],
            scheduledAt,
          }
        : {}),
      publishedAt,
      ...(publicationStatus === undefined
        ? {}
        : { publicationStatus: publicationStatus as Post['publicationStatus'] }),
      ...(metaSourceRow === undefined ? {} : { metaSourceRow }),
      ...(metaGroupName === undefined ? {} : { metaGroupName }),
      ...(metaGroupKey === undefined ? {} : { metaGroupKey }),
      ...(metaPublishedLabel === undefined ? {} : { metaPublishedLabel }),
      facebookPostId: facebookId(item.facebookPostId, 'Facebook post ID'),
      url,
      viewers,
      commentCount,
      pinned: item.pinned === true,
      color: color(item.color, 'Post color'),
      ...(item.deletedAt === undefined
        ? {}
        : { deletedAt: date(item.deletedAt, 'Post deletion date') }),
    };
  });
  unique(posts, 'Posts');
  const appliedDataUpdates =
    raw.appliedDataUpdates === undefined
      ? undefined
      : [
          ...new Set(
            array(raw.appliedDataUpdates, 'Applied data updates', 100).map((value) =>
              identifier(value, 'Data update ID'),
            ),
          ),
        ];
  const orders = validateOrders(raw.orders, companyIds);
  return {
    version: 1,
    companies,
    businessTypes,
    customers,
    scripts: validateConsoleScripts(raw.scripts, companyIds),
    orders,
    orderSequences: validateOrderSequences(raw.orderSequences, orders),
    shippingSettings: validateShippingSettings(raw.shippingSettings, companyIds),
    products,
    groups,
    destinations,
    posts,
    sample: raw.sample,
    ...(appliedDataUpdates === undefined ? {} : { appliedDataUpdates }),
  };
}
