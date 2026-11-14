/**
 * What the app told the user through a toast, as the tests see it. `setupToasts.ts` swaps the two
 * report functions of `@/shell/toasts` for these, so a test reads what was reported instead of
 * looking for a Sonner toast in the page. The real functions have their own test (toasts.test.ts).
 * The log is cleared before every test.
 */
export type ToastLevel = 'warning' | 'error'

export interface Reported {
  readonly level: ToastLevel
  readonly message: string
}

class ToastLog {
  readonly all: Reported[] = []

  record(level: ToastLevel, message: string): void {
    this.all.push({ level, message })
  }

  clear(): void {
    this.all.length = 0
  }

  /** Every message, oldest first. */
  get messages(): string[] {
    return this.all.map((toast) => toast.message)
  }

  /** The newest message, or null when nothing was reported. */
  get last(): string | null {
    return this.all.at(-1)?.message ?? null
  }

  /** The level of the newest message, or null when nothing was reported. */
  get lastLevel(): ToastLevel | null {
    return this.all.at(-1)?.level ?? null
  }

  messagesOf(level: ToastLevel): string[] {
    return this.all.filter((toast) => toast.level === level).map((toast) => toast.message)
  }
}

export const toasts = new ToastLog()
