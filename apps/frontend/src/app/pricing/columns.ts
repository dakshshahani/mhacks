// Pricing table geometry: single source of truth for tier columns.
// Figma draws uneven gutters (47/41); we deliberately even them to 44/44,
// so columns sit at 495 / 730 / 965, each 191 wide. Headers, value rows,
// and the action row all map over COLUMNS — they cannot drift apart.
export const COLUMNS = [495, 730, 965];
export const COLUMN_WIDTH = 191;
/** Frame-absolute x → table-section-local x (table starts at frame x84). */
export const TABLE_X = 84;
export function colLocal(x: number): number {
  return x - TABLE_X;
}
