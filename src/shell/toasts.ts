import { toast } from 'vue-sonner'

/** How long a toast stays: its own timer, started when it shows and paused while the pointer is on it. */
export const TOAST_MS = 12_000

/**
 * Tells the user about something that did not work. Two levels, an error (red) and a warning
 * (amber): a warning is a refusal or a thing the app could not do for a reason the user can see
 * ("Link target not found"), an error is a failure it could not explain away ("Could not open ...").
 *
 * The message is the toast's id, so the same message shown twice is one toast whose timer starts
 * again; different messages stack. Nothing here clears a toast: they go on their own after
 * `TOAST_MS`, and `dismissAllToasts` closes them all when the active tab changes.
 */
export function reportError(message: string): void {
  toast.error(message, { id: message, duration: TOAST_MS })
}

export function reportWarning(message: string): void {
  toast.warning(message, { id: message, duration: TOAST_MS })
}

/** Closes every toast now. */
export function dismissAllToasts(): void {
  toast.dismiss()
}
