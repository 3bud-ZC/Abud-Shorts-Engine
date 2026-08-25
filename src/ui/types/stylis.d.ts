/**
 * `stylis` ships no bundled type declarations. Only the `prefixer` middleware is
 * used here - the emotion RTL cache passes it straight through to
 * `createCache({ stylisPlugins })` - so it is declared with emotion's own
 * middleware signature rather than typed out in full.
 */
declare module "stylis" {
  export const prefixer: (
    element: unknown,
    index: number,
    children: unknown[],
    callback: unknown,
  ) => string | void;
}
