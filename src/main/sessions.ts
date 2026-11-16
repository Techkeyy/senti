// OWNER: UI builder. Session storage in userData/sessions/<id>/, the senti-media:// protocol for
// recordings, and F8/F9 global hotkeys during play. See src/shared/session.ts and src/shared/ipc.ts.
import type { BrowserWindow } from 'electron'

/** Call before app ready (privileged scheme registration). */
export function registerSessionSchemes(): void {
  // implemented by the UI builder
}

/** Call after app ready. */
export function registerSessions(_getWindow: () => BrowserWindow | null): void {
  // implemented by the UI builder
}
