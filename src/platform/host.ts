/** Everything the UI needs from the machine. Implemented once per runtime. */
export interface Host {
  readonly kind: 'tauri' | 'browser'
  /** The OS name, as reported by the platform layer. */
  platformName(): Promise<string>
  /** Shows the window. It starts hidden so launch never flashes a blank frame. */
  showWindow(): Promise<void>
}
