/**
 * DOM ids that more than one module points at. Their own module so a caller (the app
 * shell's skip link, `StockList`'s focus management) can name them without importing
 * the page that renders them — in particular without pulling in the lazily loaded
 * `StockDetail` chunk.
 */

/** The board's `<tbody>`: where "Skip to instruments" lands (on its Tab-stop row). */
export const BOARD_ID = 'tckr-board';

/** The open symbol's heading in the detail pane. `StockList` moves focus here when
 * opening the detail hides the element that had focus (the phone split view). */
export const DETAIL_HEADING_ID = 'tckr-detail-heading';
