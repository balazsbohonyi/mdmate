import { createApp, h, type App, type Component } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'

// The popper that places a tooltip measures with this; jsdom does not have it.
class FakeObserver {
  observe = (): undefined => undefined
  unobserve = (): undefined => undefined
  disconnect = (): undefined => undefined
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  Object.assign(globalThis, { ResizeObserver: FakeObserver })
}

/**
 * An app that draws a component inside the one TooltipProvider the real app has at its root, with
 * no delay so a hover shows its tooltip at once. Components with a HoverHint need it (ISC-222).
 */
export function tooltipApp(component: Component, props: Record<string, unknown> = {}): App {
  return createApp({
    render: () => h(TooltipProvider, { delayDuration: 0 }, () => h(component, props)),
  })
}
