import type { Post, Product } from './types';

/** Resolve every product in one pass through the posts for catalog and picker lists. */
export function productCompanyIdMap(
  products: readonly Pick<Product, 'id' | 'companyIds'>[],
  posts: readonly Pick<Post, 'productId' | 'companyId'>[],
): Map<string, string[]> {
  const linkedCompanies = new Map<string, Set<string>>();
  for (const post of posts) {
    if (!post.productId) continue;
    let companies = linkedCompanies.get(post.productId);
    if (!companies) {
      companies = new Set();
      linkedCompanies.set(post.productId, companies);
    }
    companies.add(post.companyId);
  }
  return new Map(
    products.map((product) => [
      product.id,
      product.companyIds === undefined
        ? [...(linkedCompanies.get(product.id) ?? [])]
        : [...product.companyIds],
    ]),
  );
}

/** Explicit company choices take precedence; older products inherit companies from their linked posts. */
export function effectiveProductCompanyIds(
  product: Pick<Product, 'id' | 'companyIds'>,
  posts: readonly Pick<Post, 'productId' | 'companyId'>[],
): string[] {
  if (product.companyIds !== undefined) return [...product.companyIds];
  return [
    ...new Set(posts.filter((post) => post.productId === product.id).map((post) => post.companyId)),
  ];
}
