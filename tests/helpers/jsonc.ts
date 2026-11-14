import { parse } from 'jsonc-parser'

/** Reads the text of settings.json or keybindings.json: JSON with comments and trailing commas. */
export function parseJsonc(text: string): unknown {
  return parse(text, [], { allowTrailingComma: true })
}
