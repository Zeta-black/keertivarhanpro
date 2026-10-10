/**
 * 3Dmol.js ships no type declarations for its ES-module build. Only the
 * surface `Structure3D.tsx` actually calls is declared here, so a typo in a
 * viewer call is still a compile error rather than an `any` hole.
 */
declare module '3dmol/build/3Dmol.es6-min.js' {
  export function createViewer(
    element: HTMLElement,
    config?: {
      backgroundColor?: string;
      backgroundAlpha?: number;
      antialias?: boolean;
      id?: string;
    },
  ): unknown;
}
