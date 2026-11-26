// @vitest-environment jsdom
/**
 * ISC-741: the task checkbox is drawn by the app from theme tokens, so it is tinted like the page in
 * every theme. It is still a checkbox input and a press still changes one character.
 *
 * jsdom draws nothing, so the look is read from the rules CodeMirror puts into the page.
 */
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { toggleCheckbox } from '@/editor/livePreview/checkbox'
import { mountPreview } from '../helpers/blocks'
import { valuesOf } from '../helpers/editorRules'

let view: EditorView | undefined

afterEach(() => {
  view?.destroy()
  view = undefined
  document.body.replaceChildren()
})

const DOC = '- [ ] open\n- [x] done\n\nend'

const boxes = (): HTMLInputElement[] => {
  view = mountPreview(DOC, DOC.length)
  return [...view.contentDOM.querySelectorAll<HTMLInputElement>('input.cm-md-checkbox')]
}

const one = (selector: string, property: string): string | undefined =>
  valuesOf(selector, property).at(-1)

describe('the drawn checkbox (ISC-741)', () => {
  it('is still a checkbox input with the state of its marker', () => {
    expect(boxes().map((box) => [box.type, box.checked])).toEqual([
      ['checkbox', false],
      ['checkbox', true],
    ])
  })

  it('turns the native look off', () => {
    boxes()
    expect(one('.cm-md-checkbox', 'appearance')).toBe('none')
  })

  it('fills the open box with the checkbox token and outlines it', () => {
    boxes()
    expect(one('.cm-md-checkbox', 'background-color')).toBe('var(--checkbox-background)')
    expect(one('.cm-md-checkbox', 'border')).toBe('1px solid var(--muted-foreground)')
  })

  it('fills the checked box with the primary colour and draws a tick on it', () => {
    boxes()
    expect(one('.cm-md-checkbox:checked', 'background-color')).toBe('var(--primary)')
    expect(one('.cm-md-checkbox:checked', 'border-color')).toBe('var(--primary)')
    expect(one('.cm-md-checkbox:checked::after', 'content')).toMatch(/^(""|'')$/)
    expect(one('.cm-md-checkbox:checked::after', 'border-color')).toBe('var(--primary-foreground)')
    expect(one('.cm-md-checkbox:checked::after', 'transform')).toContain('rotate')
  })

  it('changes one character on a press, as before', () => {
    const [open] = boxes()
    expect(toggleCheckbox(view!, open!)).toBe(true)
    expect(view!.state.doc.toString()).toBe(DOC.replace('[ ]', '[x]'))
  })
})
