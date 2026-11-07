/** One line of the app menu. Phase 1's command registry (P1-T6) will produce these. */
export type MenuEntry =
  | {
      readonly kind: 'item'
      readonly id: string
      readonly label: string
      readonly shortcut?: string
      readonly disabled?: boolean
    }
  | { readonly kind: 'separator' }
