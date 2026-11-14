/**
 * Putting a picture into a document: what a paste carries, the link that stands for the saved file,
 * and the one edit that inserts it. The editor knows nothing about files. The document hands it a
 * sink that saves the bytes (next to the document, by Rust) and says where they went, and one that
 * takes a file dropped from Explorer, which Rust links where it lies or copies in.
 */
import { Facet } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/** How a notice reads: a refusal the user can fix by choosing another file is a warning, a failure an error. */
export type NoticeLevel = 'warning' | 'error'

/** What the editor needs from the app to take an image into a document. */
export interface ImageSink {
  /** The notice to show instead of saving, or null when this document can take an image now. */
  refusal(): string | null
  /** Saves the bytes next to the document and resolves to the path to write in the link. */
  save(bytes: ArrayBuffer): Promise<string>
  /** Handles a dropped file (a path a native drop delivered) and resolves to the path to write. */
  drop(path: string): Promise<string>
  /** Tells the user about something that did not work (`error`) or was refused (`warning`). */
  notify(message: string, level: NoticeLevel): void
}

/** Provided per tab. Without it a paste of an image is an ordinary paste. */
export const imageSink = Facet.define<ImageSink, ImageSink | null>({
  combine: (values) => values[0] ?? null,
})

/** The picture types the app saves. Rust checks the bytes again; this only picks what to offer it. */
const IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

/**
 * The image files a paste carries, or none when it should paste as it always did. A screenshot is
 * one `image/png` file; an Explorer copy is one file per picture with its real name and type, and
 * no path (checked in the real window, P9-T1 decisions). Text on the clipboard as well means the
 * picture is only a preview of it (a copied spreadsheet range, a web page), and the text wins.
 */
export function pastedImageFiles(data: DataTransfer | null): File[] {
  if (data === null) return []
  if (data.getData('text/plain') !== '' || data.getData('text/html') !== '') return []
  return [...data.files].filter((file) => IMAGE_TYPES.has(file.type))
}

/**
 * The name of a new picture's file, from the local time: `YYYYMMDD-HHMMSS`. Rust holds the stamp to
 * exactly this shape, so it can never name anything but a file.
 */
export function imageStamp(now: Date = new Date()): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  return (
    `${String(now.getFullYear()).padStart(4, '0')}${two(now.getMonth() + 1)}${two(now.getDate())}` +
    `-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  )
}

/**
 * The address part of a link to `path`: `/` as the separator, the address written bare when it
 * can be and in angle brackets when it holds a space or a parenthesis, which would end it early.
 * A `%` is written `%25`, because the address is read back percent-decoded, and `#` and `?` are
 * written `%23` and `%3F`, because bare they would start a fragment or a query, which are not part
 * of a file name.
 */
export function linkTarget(path: string): string {
  const slashed = path
    .replaceAll('\\', '/')
    .replaceAll('%', '%25')
    .replaceAll('#', '%23')
    .replaceAll('?', '%3F')
  // Angle brackets cannot wrap an address that holds one, and a line break would end the link.
  if (/[<>\r\n]/.test(slashed)) {
    return slashed.replace(
      /[<>\r\n()\s]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
    )
  }
  return /[\s()]/.test(slashed) ? `<${slashed}>` : slashed
}

/** The Markdown for a picture at `path`, with no alt text: the owner writes that. */
export function imageMarkdown(path: string): string {
  return `![](${linkTarget(path)})`
}

/**
 * Saves each file and inserts one link per picture where the caret was, as a single edit (one undo
 * step; the files stay on disk if it is undone). Failures and refusals go to the sink's notice and
 * nothing is inserted for the picture that failed.
 */
export async function insertImages(
  view: EditorView,
  sink: ImageSink,
  files: readonly File[],
): Promise<void> {
  const refusal = sink.refusal()
  if (refusal !== null) {
    sink.notify(refusal, 'warning')
    return
  }
  const saved: string[] = []
  try {
    for (const file of files) saved.push(await sink.save(await file.arrayBuffer()))
  } catch (error) {
    sink.notify(`Could not save the image: ${reasonOf(error)}`, levelOf(error))
  }
  if (saved.length === 0) return
  insertLinks(view, sink, saved)
}

/**
 * A host error that says the file is not one the app takes (not a picture, too large, outside what
 * it may read) is a warning; anything else, a disk that failed for instance, is an error.
 */
function levelOf(error: unknown): NoticeLevel {
  const kind =
    typeof error === 'object' && error !== null && 'kind' in error ? error.kind : undefined
  return kind === 'invalid' || kind === 'not-allowed' ? 'warning' : 'error'
}

/** The last part of a path, for a message that names the file. */
function nameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function reasonOf(error: unknown): string {
  const text =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : String(error)
  // Rust words a refusal "invalid request: <why>"; the user wants the why.
  return text.replace(/^invalid request: /, '')
}

/** Where a drop at `point` (page pixels) lands in the text of `view`, or null outside its text. */
export function dropPosition(view: EditorView, point: { x: number; y: number }): number | null {
  return view.posAtCoords(point)
}

/**
 * Handles pictures dropped at `at` (a position in the text): each path goes to the sink, which
 * links the file where it lies or copies it in, and one link per picture goes in at the drop point
 * as a single edit. Failures and refusals go to the sink's notice. Returns false when the view
 * takes no images, so the caller can do what it always did with the drop.
 */
export async function insertDropped(
  view: EditorView,
  paths: readonly string[],
  at: number,
): Promise<boolean> {
  const sink = view.state.facet(imageSink)
  // A view that cannot be edited takes no link; the caller opens the picture in a tab instead.
  if (sink === null || view.state.readOnly) return false
  const refusal = sink.refusal()
  if (refusal !== null) {
    sink.notify(refusal, 'warning')
    return true
  }
  const links: string[] = []
  for (const path of paths) {
    try {
      links.push(await sink.drop(path))
    } catch (error) {
      // Every file that fails gets a message of its own, starting with its name.
      const level = levelOf(error)
      const reason = reasonOf(error)
      sink.notify(
        level === 'warning'
          ? `${nameOf(path)}: ${reason}`
          : `Could not add ${nameOf(path)}: ${reason}`,
        level,
      )
    }
  }
  if (links.length > 0) insertLinks(view, sink, links, at)
  return true
}

/**
 * Inserts links for pictures that are already saved, at the caret or, for a drop, at `at` (held
 * to the text as it is now, since it may have changed while the files were being handled). When the
 * view has moved on to another tab meanwhile, the links go nowhere and the user is told where the
 * files are.
 */
export function insertLinks(
  view: EditorView,
  sink: ImageSink,
  paths: readonly string[],
  at?: number,
): void {
  if (view.state.facet(imageSink) !== sink || view.state.readOnly) {
    sink.notify(
      `Saved ${paths.join(', ')}, but the document it was meant for is not showing`,
      'warning',
    )
    return
  }
  const insert = paths.map(imageMarkdown).join('\n')
  if (at !== undefined) {
    const where = Math.max(0, Math.min(at, view.state.doc.length))
    view.dispatch({
      changes: { from: where, insert },
      selection: { anchor: where + insert.length },
      scrollIntoView: true,
      userEvent: 'input.drop',
    })
    return
  }
  const range = view.state.selection.main
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
    scrollIntoView: true,
    userEvent: 'input.paste',
  })
}
