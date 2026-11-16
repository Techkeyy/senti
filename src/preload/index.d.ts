import type { SentiApi } from '../shared/ipc'

declare global {
  interface Window {
    senti: SentiApi
  }
}
