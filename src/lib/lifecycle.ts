let resolveShown: () => void = () => undefined

/** Settles once the window is on screen. The perf harness times "launch to editable" with it. */
export const windowShown = new Promise<void>((resolve) => {
  resolveShown = resolve
})

export function reportWindowShown(): void {
  // The mark records when the window showed, which can be before anyone starts waiting for it.
  performance.mark('window-shown')
  resolveShown()
}
