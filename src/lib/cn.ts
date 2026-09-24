/** Joins class names, skipping falsy values (so `cond && 'class'` works with any condition type). */
export function cn(...parts: unknown[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' ')
}
