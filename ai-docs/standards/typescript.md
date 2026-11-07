# TypeScript standard

Read this before writing or reviewing `.ts` files, IPC types, `tsconfig.json` or ESLint config. Sources verified 2026-11-07; "project call" marks our own conventions.

Sources: [TSConfig](https://www.typescriptlang.org/tsconfig/), [Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html), [typescript-eslint configs](https://typescript-eslint.io/users/configs/), [eslint-plugin-vue](https://eslint.vuejs.org/user-guide/)

## Enforced by tools

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "isolatedModules": true,
    "moduleResolution": "bundler",
    "noEmit": true
  }
}
```

ESLint runs typescript-eslint `recommended-type-checked` plus `stylistic-type-checked`, plus `switch-exhaustiveness-check`. We use these over `strict-type-checked` because the docs exclude `strict` from their semver stability promise.

In `.vue` files, `vue-eslint-parser` stays the top-level parser and the TypeScript parser goes in `parserOptions.parser`.

## Modeling

Model state as discriminated unions with a literal `kind`, each variant holding only its own fields. Tabs (`markdown`, `text`, `image`) and split nodes (`pane`, `split`) work this way.

```ts
type SplitNode =
  | { kind: 'pane'; id: PaneId; tabs: readonly TabId[]; activeTab: TabId | null }
  | { kind: 'split'; direction: 'row' | 'column'; children: readonly SplitNode[]; sizes: readonly number[] }

function countPanes(node: SplitNode): number {
  switch (node.kind) {
    case 'pane':
      return 1
    case 'split':
      return node.children.reduce((total, child) => total + countPanes(child), 0)
    default: {
      const unreachable: never = node
      return unreachable
    }
  }
}
```

- End switches with an exhaustive `never` check.
- Use `as const` unions in place of enums, which `erasableSyntaxOnly` rejects.
- Use `import type` for type-only imports.

## Boundaries

- Data from IPC, settings files, theme files and frontmatter enters as `unknown` and passes through a validator.
- `catch` values are `unknown`.
- Treat `as` as a last resort, with a reason comment. Prefer `satisfies` and narrowing.
- `@tauri-apps` imports appear only inside `src/platform/`.
- IPC types live in one file mirroring the Rust structs, changed in the same commit as those structs.

## Async (project call)

- Every promise is awaited or explicitly handled.
- Search, outline and file loads carry a request ID, and stale results are dropped.

## Editor code (project call)

`src/editor/` is plain TypeScript with no Vue imports, tested through headless `EditorState` in Vitest. Widgets are plain DOM styled with tokens.
