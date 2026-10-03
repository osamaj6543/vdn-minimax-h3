/** The landing page's horizontal rhythm — one source of truth for the page edge.
 *
 *  The layout is **full-bleed**: sections span the viewport instead of a centred
 *  column, and only the edge padding grows with the screen (5 → 8 → 12 → 16
 *  units), so the nav, every section and the footer line up on the same two
 *  vertical rails at any width.
 *
 *  Full width is a layout decision, not a line-length one: long-form copy keeps
 *  its own `max-w-*` measure (`SectionIntro`'s lead, the hero paragraph, the FAQ)
 *  so a wide monitor never turns a sentence into a 200-character line.
 */
export const LANDING_SHELL = "w-full px-5 sm:px-8 lg:px-12 2xl:px-16";
