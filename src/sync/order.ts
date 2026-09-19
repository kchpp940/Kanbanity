// Base-62 fractional indexing. Generated keys never start or end with the
// zero digit, which keeps midpoint computations stable.
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0];
const BASE = DIGITS.length;

function digitAt(value: string | null, index: number): number {
  if (value === null || index >= value.length) {
    return 0;
  }
  return DIGITS.indexOf(value[index]);
}

/**
 * Returns a key strictly between `a` and `b` (null = open edge).
 */
export function midpoint(a: string | null, b: string | null): string {
  const left = a === null ? null : a.replace(/0+$/g, "");
  const right = b === null ? null : b.replace(/z+$/g, "");

  if (left !== null && left[0] === ZERO) {
    throw new Error("midpoint: left edge may not use zero-prefixed keys");
  }
  if (left !== null && right !== null && left >= right) {
    throw new Error(`midpoint: empty interval [${a}, ${b}]`);
  }

  let prefix = "";
  let i = 0;
  while (true) {
    if (prefix.length > 256) {
      throw new Error("midpoint: key space exhausted");
    }
    const ad = digitAt(left, i);
    // A missing right suffix behaves like the open max edge (digit BASE).
    const bd = right !== null && i < right.length ? digitAt(right, i) : BASE;
    if (ad !== bd) {
      const mid = Math.floor((ad + bd) / 2);
      if (mid > ad) {
        return prefix + DIGITS[mid];
      }
      // Adjacent digits: descend into the lower digit's subtree.
      prefix += DIGITS[ad];
      i += 1;
      continue;
    }
    prefix += left !== null && i < left.length ? left[i] : right![i];
    i += 1;
  }
}

/** Builds deterministic evenly spaced keys for `count` items. */
export function evenlySpacedKeys(count: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) {
    keys.push(midpoint(keys[i - 1] ?? null, null));
  }
  return keys;
}

/** Key placing an item at `index` within the given ordered sibling keys. */
export function keyForIndex(
  orderedKeys: readonly string[],
  index: number
): string {
  const before = index > 0 ? orderedKeys[index - 1] : null;
  const after = index < orderedKeys.length ? orderedKeys[index] : null;
  return midpoint(before, after);
}

export { DIGITS, BASE };
