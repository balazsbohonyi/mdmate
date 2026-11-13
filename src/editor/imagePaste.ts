/**
 * Putting a picture into a document: what a paste carries, the link that stands for the saved file,
 * and the one edit that inserts it. The editor knows nothing about files. The document hands it a
 * sink that saves the bytes (next to the document, by Rust) and says where they went.
 */
import { Facet } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/** What the editor needs from the app to take an image into a document. */
export interface ImageSink {
  /** The notice to show instead of saving, or null when this document can take an image now. */
  refusal(): string | null
  /** Saves the bytes next to the document and resolves to the path to write in the link. */
  save(bytes: ArrayBuffer): Promise<string>
  /** Tells the user about something that did not work, or was refused. */
  notify(message: string): void
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
    sink.notify(refusal)
    return
  }
  const saved: string[] = []
  try {
    for (const file of files) saved.push(await sink.save(await file.arrayBuffer()))
  } catch (error) {
    const reason =
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : String(error)
    sink.notify(`Could not save the image: ${reason}`)
  }
  if (saved.length === 0) return
  insertLinks(view, sink, saved)
}

/**
 * Inserts links for pictures that are already saved, at the caret. When the view has moved on to
 * another tab meanwhile, the links go nowhere and the user is told where the files are.
 */
export function insertLinks(view: EditorView, sink: ImageSink, paths: readonly string[]): void {
  if (view.state.facet(imageSink) !== sink || view.state.readOnly) {
    sink.notify(`Saved ${paths.join(', ')}, but the document it was meant for is not showing`)
    return
  }
  const range = view.state.selection.main
  const insert = paths.map(imageMarkdown).join('\n')
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
    scrollIntoView: true,
    userEvent: 'input.paste',
  })
}
