import { reactive } from 'vue'

/**
 * What a rename or move does about the links that point at the file:
 * - `ask`: asks first, with "Yes" as the answer Enter gives, and looks for links only
 *   when told to;
 * - `update`: looks for the links and updates them without asking;
 * - `never`: looks for no links at all; the file is only renamed or moved.
 */
export type LinksOnRename = 'ask' | 'update' | 'never'

/** The values, for checking what comes from outside the page. */
export const LINKS_ON_RENAME: readonly LinksOnRename[] = ['ask', 'update', 'never']

/**
 * The settings the page reads. Only what a finished feature needs is here, with the defaults the
 * plan names. P8-T1 fills this from `settings.json` and applies a change as it is saved; until
 * then a setting can only be changed from code, so a test or the console can try every value, and
 * `links.onRename` can also be set by the `MDMATE_LINKS_ON_RENAME` environment variable, which
 * wins over this object (see `host.linksOnRenameOverride`).
 */
export interface Settings {
  links: {
    onRename: LinksOnRename
  }
}

const DEFAULTS: Readonly<Settings> = { links: { onRename: 'never' } }

export const settings = reactive<Settings>({ links: { ...DEFAULTS.links } })

/** Goes back to the defaults, for a test. */
export function resetSettings(): void {
  settings.links.onRename = DEFAULTS.links.onRename
}
