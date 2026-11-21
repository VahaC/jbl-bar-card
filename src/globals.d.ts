/** Injected by vite.config.ts from package.json. */
declare const __CARD_VERSION__: string;

/** Vite raw imports (the product illustrations in assets/). */
declare module "*.svg?raw" {
  const content: string;
  export default content;
}

interface CustomCardEntry {
  type: string;
  name?: string;
  description?: string;
  preview?: boolean;
  documentationURL?: string;
  getEntitySuggestion?: (hass: unknown, entityId: string) => { config: Record<string, unknown>; label?: string } | null;
}

interface Window {
  customCards?: CustomCardEntry[];
  loadCardHelpers?: () => Promise<unknown>;
}
