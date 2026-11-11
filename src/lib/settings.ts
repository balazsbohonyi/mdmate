import { reactive } from 'vue'

/**
 * The settings the page reads. Only what a finished feature needs is here, with the defaults the
 * plan names. P8-T1 fills this from `settings.json` and applies a change as it is saved; until
 * then a setting can only be changed from code, so a test or the console can try both values.
 */
export interface Settings {
  links: {
    /** Ask "N links in M files" before a rename or move rewrites links. */
    confirmRewrite: boolean
  }
}

const DEFAULTS: Readonly<Settings> = { links: { confirmRewrite: true } }

export const settings = reactive<Settings>({ links: { ...DEFAULTS.links } })

/** Goes back to the defaults, for a test. */
export function resetSettings(): void {
  settings.links.confirmRewrite = DEFAULTS.links.confirmRewrite
}
