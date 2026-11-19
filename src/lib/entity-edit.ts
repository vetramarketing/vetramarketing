/** Validated entities contain plain JSON fields, including optional nested media metadata. */
function equalValue(original: unknown, current: unknown): boolean {
  if (Object.is(original, current)) return true;
  if (!original || !current || typeof original !== 'object' || typeof current !== 'object')
    return false;
  if (Array.isArray(original) !== Array.isArray(current)) return false;
  const left = original as Record<string, unknown>;
  const right = current as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && equalValue(left[key], right[key]))
  );
}

/** An editor may save only while the entity it opened is still unchanged. */
export function entityEditIsCurrent<T extends { id: string }>(
  original: T | null,
  current: T | undefined,
): boolean {
  if (!original) return current === undefined;
  if (!current) return false;

  return equalValue(original, current);
}
