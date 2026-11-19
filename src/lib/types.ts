import type { CloudinaryImage } from './cloudinary-media';
import type { ShippingAddress } from './shipping-address';
import type { Order, ShippingSettings } from './orders';
import type { ConsoleScript } from './console-scripts';
export type { ConsoleScript, ScriptPlatform } from './console-scripts';
export type {
  CarrierId,
  Order,
  OrderItem,
  OrderLabel,
  OrderShipment,
  OrderStatus,
  OrderPaymentMethod,
  ShippingAddress,
  ShippingSettings,
} from './orders';

export type Locale = 'th' | 'en';
export type Platform = 'facebook' | 'instagram' | 'tiktok' | 'linkedin';
export type PostStatus = 'draft' | 'planned' | 'published';
export type View =
  | 'overview'
  | 'posts'
  | 'scripts'
  | 'groups'
  | 'analytics'
  | 'products'
  | 'companies'
  | 'customers'
  | 'orders'
  | 'settings'
  | 'trash';
export interface Company {
  id: string;
  name: string;
  businessTypeId: string;
  logoImageUrl: string;
  logoAsset?: CloudinaryImage;
  ownerName: string;
  sortOrder: number;
  /** Preserved branding from older workspaces; no longer required in the editor. */
  initials: string;
  color: string;
  description: string;
}
export type CustomerSection = 'social' | 'domains' | 'github';
export type CustomerFieldType = 'text' | 'email' | 'url' | 'date' | 'textarea';
export interface CustomerFieldDefinition {
  id: string;
  label: string;
  type: CustomerFieldType;
  archived?: boolean;
}
/** Profiles are data, so adding a business type does not require a new customer schema. */
export interface BusinessType {
  id: string;
  name: string;
  nameTh?: string;
  customerSections: CustomerSection[];
  customerFields: CustomerFieldDefinition[];
  sortOrder: number;
}
export type CustomerContactType =
  'facebook' | 'line' | 'whatsapp' | 'email' | 'instagram' | 'phone' | 'custom';
export interface CustomerContact {
  id: string;
  label: string;
  url: string;
  /** Missing on older links; their existing label remains the source of truth. */
  type?: CustomerContactType;
}
export interface Customer {
  id: string;
  companyId: string;
  name: string;
  organization: string;
  contactName: string;
  email: string;
  phone: string;
  recipient?: ShippingAddress;
  website: string;
  /** Date only; absent on customer records saved before this field existed. */
  firstContactOn?: string;
  lastContactOn: string;
  notes: string;
  socialLinks: CustomerContact[];
  /** Optional for older customers; retain associations while products are in Trash. */
  productIds?: string[];
  /** Legacy cumulative counts used to seed order history. Live totals come from linked orders. */
  productQuantities?: Record<string, number>;
  domains: { id: string; domain: string; expiresOn: string }[];
  githubAccounts: { id: string; name: string; email: string; username: string }[];
  /** Values remain available when the company changes business type or a field is archived. */
  fieldValues: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
/** Shared catalog with explicit company associations for new products. */
export interface Product {
  id: string;
  name: string;
  imageUrl: string;
  imageAsset?: CloudinaryImage;
  /** Omitted on legacy products until a company is selected. */
  companyIds?: string[];
  sortOrder: number;
  deletedAt?: string;
}
export interface Group {
  id: string;
  companyId: string;
  name: string;
  facebookId: string;
  category: string;
  notes: string;
  deletedAt?: string;
}
/** A stable, company-scoped place where a post was published. */
export interface Destination {
  id: string;
  companyId: string;
  platform: Platform;
  kind: 'group' | 'page' | 'account';
  externalId: string;
  name: string;
  /** Group details remain in the existing group catalog. */
  groupId?: string;
  deletedAt?: string;
}
/** A saved social post or a provisional Meta row awaiting publication confirmation. */
export interface PublishedPost {
  id: string;
  companyId: string;
  groupId: string;
  product: string;
  /** Stable catalog link; product remains the name recorded with the post. */
  productId?: string;
  /** Stable publishing destination, when it can be identified. */
  destinationId?: string;
  platform: Platform;
  /** Actual publication time; empty means unknown and is treated as Pending in the workspace. */
  publishedAt: string;
  /** Explicit Pending may retain a known publication time; empty dates are Pending even for legacy records. */
  publicationStatus?: 'published' | 'pending';
  /** Row number in the supplied Meta table, retained for later reconciliation. */
  metaSourceRow?: number;
  /** Destination snapshot preserved if its group is later removed from the catalog. */
  metaGroupName?: string;
  /** Numeric group ID or stable group slug supplied by the team's group directory. */
  metaGroupKey?: string;
  /** Day/month/time copied from Meta when it omitted the publication year. */
  metaPublishedLabel?: string;
  facebookPostId: string;
  url: string;
  /** Latest known total only; null means the total has not been entered. */
  viewers: number | null;
  /** Latest known comments total; omitted in older backups, null means unknown. */
  commentCount?: number | null;
  /** Pinned posts appear before unpinned posts in every post list. Absent in older data. */
  pinned?: boolean;
  color: string;
  deletedAt?: string;
}
/** Older backup fixtures may still carry retired planning fields. */
export type Post = PublishedPost & {
  title?: string;
  content?: string;
  status?: PostStatus;
  scheduledAt?: string;
};
export interface Workspace {
  version: 1;
  companies: Company[];
  businessTypes: BusinessType[];
  customers: Customer[];
  /** Absent in older backups; console snippets are stored as text only. */
  scripts?: ConsoleScript[];
  /** Absent in legacy backups; normalized to an empty order list on load. */
  orders?: Order[];
  /** Daily high-water marks prevent reuse after expired orders leave Trash. */
  orderSequences?: Record<string, number>;
  shippingSettings?: ShippingSettings;
  products: Product[];
  groups: Group[];
  /** Normalized on load; optional in legacy in-memory fixtures. */
  destinations?: Destination[];
  posts: Post[];
  sample: boolean;
  /** One-time supplied data additions; retained in backups to respect later edits/deletion. */
  appliedDataUpdates?: string[];
}
export type Translate = (en: string, th: string) => string;
