import createCache, { type EmotionCache } from "@emotion/cache";
import { prefixer } from "stylis";
import rtlPlugin from "stylis-plugin-rtl";

/**
 * DIRECTION-AWARE STYLE CACHES
 * ----------------------------
 * Setting `dir="rtl"` on the document flips text and inline layout, but it does
 * not flip the physical CSS that MUI and this application emit - a
 * `margin-left: 16px` stays on the left in an Arabic interface, which is how an
 * RTL layout ends up with its spacing on the wrong side of every element.
 *
 * The RTL cache runs an emotion middleware that mirrors physical properties as
 * the styles are serialised, so `margin-left` becomes `margin-right`,
 * `border-left` becomes `border-right`, and `padding: 0 8px 0 24px` is
 * reversed. Nothing in a component has to know which direction it is in.
 *
 * Two caches exist rather than one mutable cache because emotion memoises
 * serialised rules by key: swapping the plugin on a live cache would leave
 * already-inserted LTR rules in the stylesheet. Each direction owns its own key
 * and its own `<style>` tags, so switching language swaps the whole sheet.
 */

let ltrCache: EmotionCache | undefined;
let rtlCache: EmotionCache | undefined;

export function getDirectionCache(direction: "ltr" | "rtl"): EmotionCache {
  if (direction === "rtl") {
    if (!rtlCache) {
      rtlCache = createCache({
        key: "abud-rtl",
        stylisPlugins: [prefixer, rtlPlugin],
        prepend: true,
      });
    }
    return rtlCache;
  }

  if (!ltrCache) {
    ltrCache = createCache({ key: "abud", prepend: true });
  }
  return ltrCache;
}
