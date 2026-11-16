// OWNER: sensing builder. Native SDK camera in main, face-only metrics, destroy-and-rebuild recovery,
// per-second SecondSample aggregation, SensingEvent + PreviewFrame pushes. See src/shared/session.ts.
import type { BrowserWindow } from 'electron'

export function registerSensing(_getWindow: () => BrowserWindow | null): void {
  // implemented by the sensing builder
}
