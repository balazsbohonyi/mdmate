/**
 * Proof that live preview ran, read from the page the user would see. A scenario that reports a
 * fast time with the layer silently off would be worse than no number, so every run with preview
 * on adds these counts to its values.
 */
export function probePreview(): Record<string, number> {
  const lines = [...document.querySelectorAll('.cm-md-h')]
  return {
    headingLinesInDom: lines.length,
    // Only the heading the caret is on may still show its hashes.
    headingsShowingHashes: lines.filter((el) => (el.textContent ?? '').startsWith('#')).length,
  }
}
