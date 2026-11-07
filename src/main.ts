import { createApp } from 'vue'
import App from './App.vue'
import './styles/tokens.css'

createApp(App).mount('#app')
performance.mark('app-mounted')

// Only `pnpm perf` sets this. A normal build replaces it with `undefined` and drops the import.
if (import.meta.env.VITE_MDMATE_PERF) {
  void import('./perf/run').then(({ runPerf }) => runPerf())
}
