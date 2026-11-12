/**
 * The look of a switch button (Match case, Whole word, Regular expression) in the Find bar and in
 * the Search panel: filled with the accent color when on, flat when off, so what is on reads at a
 * glance.
 */
export const toggleVariant = (on: boolean): 'default' | 'ghost' => (on ? 'default' : 'ghost')
