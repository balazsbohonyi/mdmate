import type { PageEnv } from './params'

/** When the next frame's main-thread work began and when it finished. */
export interface FrameMarks {
  start: number
  end: number
}

/**
 * Watches the next frame. Call it BEFORE the work you want inside that frame: callbacks run in
 * the order they were requested, so work scheduled later (such as CodeMirror's own measuring)
 * falls between `start` and `end`. `end - start` is what the frame cost the main thread:
 * animation callbacks, style, layout and paint. It does not include the wait for the frame.
 */
export function observeNextFrame(): Promise<FrameMarks> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const start = performance.now()
      // The animation callbacks run before this frame's style, layout and paint. A message
      // queued from here is a later task, so it lands after them.
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        resolve({ start, end: performance.now() })
      }
      channel.port2.postMessage(null)
    })
  })
}

/** Resolves, with the time, once the frame after this call has been produced on the main thread. */
export async function framePresented(): Promise<number> {
  return (await observeNextFrame()).end
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Polls until `done` is true, or rejects after `timeoutMs`. */
export async function waitUntil(
  done: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (!done()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(20)
  }
}

/** Wall-clock ms since the Unix epoch, the clock the harness and Rust also use. */
export function epochNow(): number {
  return performance.timeOrigin + performance.now()
}

/** A full-window box for an editor, drawn over the app shell. */
export function mountEditorHost(): HTMLElement {
  const box = document.createElement('div')
  box.style.position = 'fixed'
  box.style.inset = '0'
  box.style.zIndex = '10'
  document.body.append(box)
  return box
}

export function decodeUtf8(bytes: ArrayBuffer): string {
  return new TextDecoder('utf-8').decode(bytes)
}

export function snapshotEnv(rafMeanMs = 0): PageEnv {
  return {
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    userAgent: navigator.userAgent,
    rafMeanMs,
  }
}

/** Mean ms between `frames` animation frames. */
export async function measureFrameCadence(frames = 30): Promise<number> {
  const start = await framePresented()
  let last = start
  for (let i = 0; i < frames; i++) last = await framePresented()
  return (last - start) / frames
}
