// Lets ESLint's TypeScript program resolve `.vue` imports. vue-tsc still
// checks against the real component types, because a real file wins over
// this ambient declaration.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<object, object, unknown>
  export default component
}

interface ImportMetaEnv {
  /** Set to `1` by `pnpm perf`. A normal build leaves it unset, so the perf driver drops out. */
  readonly VITE_MDMATE_PERF?: string
}
