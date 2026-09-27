/**
 * GSAP, set up once. This is the only module that imports `gsap`, and it is only ever
 * reached through `loadMotion()` (`motion.ts`) as a dynamic import, so GSAP lands in
 * its own chunk and never in the initial bundle — the same treatment `uplot` gets.
 * Import it statically from anywhere else and GSAP silently joins the entry chunk.
 *
 * Only the plugins something in the app uses are registered (each one is its own
 * weight in the chunk):
 *  - `CustomEase`, so GSAP runs on the same curve as every CSS reveal
 *    (`--tckr-ease-out`, cubic-bezier(0.23, 1, 0.32, 1)) under the name `tckr-out`.
 *  - `Flip`, for the board's re-rank glide (`StockList`).
 *  - `ScrambleTextPlugin`, for the stream badge's LIVE/DELAYED flip and the hero
 *    cards' closing-session label — mono labels, the machine's voice.
 *  - `SplitText`, for the daily greeting's salutation, which rises word by word.
 */
import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { Flip } from 'gsap/Flip';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(CustomEase, Flip, ScrambleTextPlugin, SplitText);

/** `--tckr-ease-out` (tokens.css), as a GSAP ease. Keep the two in step. */
CustomEase.create('tckr-out', 'M0,0 C0.23,1 0.32,1 1,1');
/** A journey from rest (the greeting's lockup flying into the header): it leaves at
 * once, gently, and spends its time arriving, with the lowest peak speed of the curves
 * tried (2.5× linear). No dead start and no surge: `expo.inOut` covered 5% of the way
 * in its first ~470ms, then peaked at 7.6× linear, which read as the page hanging and
 * then lurching. */
CustomEase.create('tckr-flight', 'M0,0 C0.25,0.1 0.2,1 1,1');

gsap.defaults({ ease: 'tckr-out', duration: 0.42 });

export { gsap, Flip, SplitText };
