import { Platform } from "react-native";

// Plugins typecheck without the DOM library. Declare only what this module uses.
type DomElement = {
  id?: string;
  parentElement?: DomElement | null;
  getBoundingClientRect?(): { left: number; top: number; width: number; height: number };
};
declare const document:
  | {
      elementFromPoint?(x: number, y: number): DomElement | null;
      getElementById?(id: string): DomElement | null;
    }
  | undefined;
declare const window: { location?: { pathname?: string } } | undefined;

/** The address Paseo's router shows, on the web and in the desktop app; null on native platforms. */
export function currentPathname(): string | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  return window.location?.pathname ?? null;
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

/** On the web, where the element with this ID is, in window coordinates; null elsewhere or when it is not on the page. */
export function rectOfId(id: string): { x: number; y: number; width: number; height: number } | null {
  if (Platform.OS !== "web" || typeof document === "undefined" || !document.getElementById) return null;
  const rect = document.getElementById(id)?.getBoundingClientRect?.();
  return rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null;
}
