// @vitest-environment jsdom
/**
 * `links.onRename` from `settings.json` (ISC-320): a saved change applies to the next rename with
 * no restart. Decided and written in the Phase 8 decisions: the environment variable
 * `MDMATE_LINKS_ON_RENAME` is a launch-time override. While it holds one of the three values it
 * wins over the file for that run, and the settings screen shows the row read-only; with it unset
 * the file decides.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDocuments } from '@/documents/store'
import { moveWithLinks } from '@/features/links/rewrite'
import { applySettingsText, resetSettingsState } from '@/features/settings/store'
import { resetTree, restoreWorkspace } from '@/features/tree/store'
import { resetSettings, settings } from '@/lib/settings'
import { setHost } from '@/platform'
import { createMockHost, type MockHost, type MockHostOptions } from '@/platform/mock'
import { resetWorkbench } from '@/workbench/store'

const FILES: Record<string, string> = {
  '/work/old.md': '# old\n',
  '/work/a.md': 'see [o](old.md)\n',
}

let host: MockHost

async function start(extra: Partial<MockHostOptions> = {}): Promise<void> {
  host = createMockHost({ files: FILES, roots: ['/work'], ...extra })
  setHost(host)
  await restoreWorkspace([])
}

beforeEach(() => {
  resetSettings()
  resetSettingsState()
})

afterEach(() => {
  resetTree()
  resetDocuments()
  resetWorkbench()
  setHost(undefined)
})

describe('links.onRename from the file (ISC-320)', () => {
  it('starts on never, and a saved file switches the next rename with no restart', async () => {
    await start()
    expect(settings.links.onRename).toBe('never')
    await moveWithLinks('/work/old.md', { kind: 'rename', name: 'one.md' })
    expect(host.files.read('/work/a.md')).toBe('see [o](old.md)\n')

    // Put the file back under the name the link uses, switch the setting, and rename again.
    await moveWithLinks('/work/one.md', { kind: 'rename', name: 'old.md' })
    applySettingsText('{"links": {"onRename": "update"}}')
    expect(settings.links.onRename).toBe('update')
    await moveWithLinks('/work/old.md', { kind: 'rename', name: 'two.md' })
    expect(host.files.read('/work/a.md')).toBe('see [o](two.md)\n')

    // And back: a key taken out of the file is `never` again, so the next rename leaves links.
    applySettingsText('{}')
    await moveWithLinks('/work/two.md', { kind: 'rename', name: 'three.md' })
    expect(host.files.read('/work/a.md')).toBe('see [o](two.md)\n')
  })

  it('an invalid value keeps the last good behaviour', async () => {
    await start()
    applySettingsText('{"links": {"onRename": "update"}}')
    applySettingsText('{"links": {"onRename": "always"}}')
    expect(settings.links.onRename).toBe('update')
    await moveWithLinks('/work/old.md', { kind: 'rename', name: 'new.md' })
    expect(host.files.read('/work/a.md')).toBe('see [o](new.md)\n')
  })

  it('the environment variable wins over the file while it is set', async () => {
    await start({ linksOnRename: 'never' })
    applySettingsText('{"links": {"onRename": "update"}}')
    expect(settings.links.onRename).toBe('update')
    await moveWithLinks('/work/old.md', { kind: 'rename', name: 'new.md' })
    expect(host.files.read('/work/a.md')).toBe('see [o](old.md)\n')
  })
})
