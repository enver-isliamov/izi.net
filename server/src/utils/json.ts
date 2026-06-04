/**
 * Stable JSON stringify to ensure consistent hashing
 */
export function stableJsonStringify(value: any): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(', ')}]`;
  }

  const sortedKeys = Object.keys(value).sort();
  const entries = sortedKeys.map((key) => `${JSON.stringify(key)}: ${stableJsonStringify(value[key])}`);
  return `{${entries.join(', ')}}`;
}
