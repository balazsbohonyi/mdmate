import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores([
    'dist/',
    'coverage/',
    'node_modules/',
    'perf-results/',
    'src-tauri/target/',
    'src-tauri/gen/',
    'tests/fixtures/',
  ]),

  // TypeScript and Vue: type-checked rules.
  {
    files: ['**/*.ts', '**/*.vue'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      pluginVue.configs['flat/recommended-error'],
    ],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },

  // In .vue files vue-eslint-parser stays the top-level parser and the
  // TypeScript parser handles the script block.
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },

  // shadcn-vue generates single-word component names.
  {
    files: ['src/components/ui/**/*.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },

  // Node scripts and config files: not in tsconfig, so no type information.
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },

  // Last, so formatting is left to Prettier.
  prettier,
)
