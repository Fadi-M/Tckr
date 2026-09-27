/**
 * Element-scoped view transitions (`Element.startViewTransition()`, MDN "Using
 * element-scoped view transitions") are not in TypeScript 5.9's DOM lib yet; only
 * `Document.startViewTransition()` is. Optional, because not every browser that has
 * the document-scoped API has this one: callers feature-detect it (see
 * `src/components/viewTransition.ts`). Delete this file once the DOM lib ships it.
 */
interface Element {
  startViewTransition?(callbackOptions?: ViewTransitionUpdateCallback | StartViewTransitionOptions): ViewTransition;
}
