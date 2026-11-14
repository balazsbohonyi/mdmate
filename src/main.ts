import { createApp } from 'vue'
import App from './App.vue'
import './styles/tokens.css'
import 'vue-sonner/style.css'
import './styles/toasts.css'
// Registers the Ctrl+click handler for links with the document store.
import './documents/links'
import { blockNativeMenu } from './lib/nativeMenu'

// Before anything draws, so the browser's own menu never shows outside text.
blockNativeMenu()
createApp(App).mount('#app')
performance.mark('app-mounted')

// Only `pnpm perf` sets this. A normal build replaces it with `undefined` and drops the import.
if (import.meta.env.VITE_MDMATE_PERF) {
  void import('./perf/run').then(({ runPerf }) => runPerf())
}
