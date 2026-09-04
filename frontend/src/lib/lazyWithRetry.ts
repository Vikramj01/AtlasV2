import { lazy, type ComponentType } from 'react';

// After a new deploy, a browser tab left open on the old `index.html` still
// references the previous build's chunk hashes — those files are gone, so
// the dynamic import() 404s with "Failed to fetch dynamically imported
// module". A single reload fetches the current index.html (correct hashes)
// and resolves it. The sessionStorage flag caps this at one retry per tab
// so a genuinely broken chunk doesn't reload-loop the user.
const RELOAD_FLAG = 'atlas-chunk-reload';

export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // sessionStorage unavailable (private mode, etc.) — nothing to clear
  }
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (error) {
      let alreadyRetried = false;
      try {
        alreadyRetried = sessionStorage.getItem(RELOAD_FLAG) === '1';
        if (!alreadyRetried) sessionStorage.setItem(RELOAD_FLAG, '1');
      } catch {
        // sessionStorage unavailable — fall through and surface the error
      }

      if (!alreadyRetried) {
        window.location.reload();
        // Reload is navigating away — never resolve so React doesn't
        // render an error state during the brief window before it completes.
        return new Promise<never>(() => {});
      }

      throw error;
    }
  });
}
