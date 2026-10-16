import { Platform } from "react-native";

// Plugins typecheck without the DOM library. Declare only what this module uses.
type DomElement = { id?: string; parentElement?: DomElement | null };
declare const document:
  | {
      addEventListener(type: string, listener: (event: unknown) => void, capture?: boolean): void;
      removeEventListener(type: string, listener: (event: unknown) => void, capture?: boolean): void;
      elementFromPoint?(x: number, y: number): DomElement | null;
    }
  | undefined;
declare const window: { location?: { pathname?: string } } | undefined;

/** The address Paseo's router shows, on the web and in the desktop app; null on native platforms. */
export function currentPathname(): string | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  return window.location?.pathname ?? null;
}

/**
 * On the web, calls `onOutside` for any press, right-click or Escape outside the
 * element `isInside` recognises, anywhere in the window. A no-op on native
 * platforms, which use an on-screen backdrop instead.
 */
export function listenOutsidePress(isInside: (target: unknown) => boolean, onOutside: () => void): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};
  const press = (event: unknown) => {
    if (!isInside((event as { target?: unknown }).target)) onOutside();
  };
  const key = (event: unknown) => {
    if ((event as { key?: string }).key === "Escape") onOutside();
  };
  document.addEventListener("mousedown", press, true);
  document.addEventListener("contextmenu", press, true);
  document.addEventListener("keydown", key, true);
  return () => {
    document?.removeEventListener("mousedown", press, true);
    document?.removeEventListener("contextmenu", press, true);
    document?.removeEventListener("keydown", key, true);
  };
}

/** Whether a DOM node rendered for `owner` (a React Native Web view ref) contains `target`. */
export function nodeContains(owner: unknown, target: unknown): boolean {
  const node = owner as { contains?: (other: unknown) => boolean } | null;
  return Boolean(node?.contains && target && node.contains(target));
}

/**
 * On the web, the ID of the innermost element at a window point, or of the
 * nearest element around it, that `matches` accepts; null elsewhere. Elements
 * with pointer events off, like a drag preview, are looked through.
 */
export function idAtPoint(x: number, y: number, matches: (id: string) => boolean): string | null {
  if (Platform.OS !== "web" || typeof document === "undefined" || !document.elementFromPoint) return null;
  for (let node = document.elementFromPoint(x, y); node; node = node.parentElement ?? null) {
    if (typeof node.id === "string" && matches(node.id)) return node.id;
  }
  return null;
}
