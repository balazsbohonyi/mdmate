/**
 * Checks on what Rust sends back: a value that is not the shape the page expects is an error here,
 * not a surprise somewhere in the list.
 */

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('not an object')
  }
  return value as Record<string, unknown>
}

export function text(object: Record<string, unknown>, field: string): string {
  const value = object[field]
  if (typeof value !== 'string') throw new Error(`${field} is not text`)
  return value
}

export function count(object: Record<string, unknown>, field: string, least: number): number {
  const value = object[field]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < least) {
    throw new Error(`${field} is not a count`)
  }
  return value
}

export function flag(object: Record<string, unknown>, field: string): boolean {
  const value = object[field]
  if (typeof value !== 'boolean') throw new Error(`${field} is not a flag`)
  return value
}
