/**
 * Selecting an image (P9-T4). A click on a drawn image does not move the caret: it sets a flag that
 * says which image is selected. A selected image stays drawn (with an outline and, once loaded, a
 * resize handle) even though a block is normally drawn only while no selection touches it, and
 * the keys act on it:
 *
 * - Delete and Backspace remove its whole source, as one step of history;
 * - Escape, or a click anywhere else, drops the selection and leaves the picture drawn;
 * - Enter and the arrow keys put the caret into the source, which shows it for editing;
 * - cut and copy take its source; typing and paste do nothing but drop the selection, because the
 *   caret they would act on is somewhere else, perhaps off screen.
 *
 * The flag is per view and is dropped by anything that moves the selection or changes the text,
 * except a transaction that sets it itself (a resize keeps the image selected).
 */
import { isolateHistory } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { Prec, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { resizeEdits, type ResizeTarget, type TextEdit } from './imageEdit'

/** The source range of the selected image. */
export interface SelectedImage {
  readonly from: number
  readonly to: number
}

/** Selects the image at this range, or with null drops the selection. */
export const selectImage = StateEffect.define<SelectedImage | null>()

export const selectedImage = StateField.define<SelectedImage | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(selectImage)) return effect.value
    if (value === null) return null
    if (tr.docChanged) return null
    if (!tr.newSelection.eq(tr.startState.selection)) return null
    if (tr.isUserEvent('select.pointer')) return null
    return value
  },
  provide: (field) =>
    EditorView.editorAttributes.from(field, (value) =>
      value === null ? {} : { class: 'cm-image-selected' },
    ),
})

/** The selected image of a state, or null. */
export function selectedImageOf(state: EditorState): SelectedImage | null {
  return state.field(selectedImage, false) ?? null
}

/** True when `item` is the selected image. */
export function isSelected(selected: SelectedImage | null, item: SelectedImage): boolean {
  return selected !== null && selected.from === item.from && selected.to === item.to
}

function deselect(view: EditorView): void {
  if (selectedImageOf(view.state) !== null) view.dispatch({ effects: selectImage.of(null) })
}

/** Runs `act` on the selected image when there is one; the key is taken only then. */
function onSelected(act: (view: EditorView, image: SelectedImage) => void) {
  return (view: EditorView): boolean => {
    const image = selectedImageOf(view.state)
    if (image === null) return false
    act(view, image)
    return true
  }
}

/** Puts the caret at `pos`, which touches the image and so shows its source. */
function reveal(view: EditorView, pos: number): void {
  view.dispatch({ selection: { anchor: pos }, effects: selectImage.of(null), scrollIntoView: true })
}

function remove(view: EditorView, image: SelectedImage): void {
  view.dispatch({
    changes: { from: image.from, to: image.to, insert: '' },
    selection: { anchor: image.from },
    effects: selectImage.of(null),
    annotations: isolateHistory.of('full'),
    userEvent: 'delete.selection',
  })
}

/** True when the image at `[from, to)` is a Markdown image alone on the first line of a paragraph that continues. */
function joinsNextLine(state: EditorState, from: number, to: number): boolean {
  const text = state.doc.sliceString(from, to)
  const lead = text.length - text.trimStart().length
  for (let node = syntaxTree(state).resolveInner(from + lead, 1); node.parent; node = node.parent) {
    if (node.name !== 'Paragraph') continue
    return node.from === from + lead && node.to > to
  }
  return false
}

/**
 * Writes a resize of the image whose widget is `wrap` to `width` pixels, as one step of history,
 * and keeps the image selected. Does nothing when the text is not what the widget was drawn from
 * (it changed since) or when the edit would change what the image says.
 */
export function commitResize(
  view: EditorView,
  wrap: HTMLElement,
  target: Omit<ResizeTarget, 'joinsNext' | 'lineBreak'> & { readonly block: boolean },
  width: number,
): boolean {
  const start = view.posAtDOM(wrap)
  const state = view.state
  const end = start + target.source.length
  if (end > state.doc.length || state.doc.sliceString(start, end) !== target.source) return false
  const edits = resizeEdits(
    {
      ...target,
      joinsNext: target.block && !target.html && joinsNextLine(state, start, end),
      lineBreak: state.lineBreak,
    },
    width,
  )
  if (edits === null || edits.length === 0) return false
  const grown = edits.reduce(
    (sum: number, edit: TextEdit) => sum + edit.insert.length - (edit.to - edit.from),
    0,
  )
  view.dispatch({
    changes: edits.map((edit) => ({
      from: start + edit.from,
      to: start + edit.to,
      insert: edit.insert,
    })),
    effects: selectImage.of({ from: start, to: end + grown }),
    annotations: isolateHistory.of('full'),
    userEvent: 'input.image.resize',
  })
  return true
}

/** The keys, the clipboard and the pointer, for a view that has the block layer. */
export function imageSelection(): Extension {
  return [
    selectedImage,
    Prec.high(
      keymap.of([
        {
          key: 'Escape',
          run: onSelected((view) => {
            deselect(view)
          }),
        },
        {
          key: 'Enter',
          run: onSelected((view, image) => {
            reveal(view, image.to)
          }),
        },
        {
          key: 'ArrowRight',
          run: onSelected((view, image) => {
            reveal(view, image.from)
          }),
        },
        {
          key: 'ArrowDown',
          run: onSelected((view, image) => {
            reveal(view, image.from)
          }),
        },
        {
          key: 'ArrowLeft',
          run: onSelected((view, image) => {
            reveal(view, image.to)
          }),
        },
        {
          key: 'ArrowUp',
          run: onSelected((view, image) => {
            reveal(view, image.to)
          }),
        },
        { key: 'Delete', run: onSelected(remove) },
        { key: 'Backspace', run: onSelected(remove) },
      ]),
    ),
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (selectedImageOf(view.state) === null) return false
        if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return false
        deselect(view)
        event.preventDefault()
        return true
      },
      paste(event, view) {
        if (selectedImageOf(view.state) === null) return false
        deselect(view)
        event.preventDefault()
        return true
      },
      copy(event, view) {
        return takeSource(event, view, false)
      },
      cut(event, view) {
        return takeSource(event, view, true)
      },
      mousedown(_event, view) {
        // Widgets handle their own clicks, so this one is a click on text or on blank space.
        deselect(view)
        return false
      },
    }),
  ]
}

/** Copy or cut of a selected image: its source goes to the clipboard, and a cut removes it. */
function takeSource(event: ClipboardEvent, view: EditorView, cut: boolean): boolean {
  const image = selectedImageOf(view.state)
  if (image === null || event.clipboardData === null) return false
  event.clipboardData.setData('text/plain', view.state.doc.sliceString(image.from, image.to))
  event.preventDefault()
  if (cut) remove(view, image)
  return true
}
