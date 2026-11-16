// Put a webcam track back into automatic exposure, white balance and focus, for whichever of
// those modes the camera supports. The SmartSpectra renderer SDK locks them to 'manual' once it
// is running and never restores them (SDK issue #19), which can leave the camera near-black.
type ModeCaps = { exposureMode?: string[]; whiteBalanceMode?: string[]; focusMode?: string[] }

export async function cameraAuto(track: MediaStreamTrack): Promise<void> {
  const caps = (track.getCapabilities?.() ?? {}) as ModeCaps
  const advanced: Record<string, string>[] = []
  if (caps.exposureMode?.includes('continuous')) advanced.push({ exposureMode: 'continuous' })
  if (caps.whiteBalanceMode?.includes('continuous')) advanced.push({ whiteBalanceMode: 'continuous' })
  if (caps.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' })
  if (advanced.length) await track.applyConstraints({ advanced } as MediaTrackConstraints).catch(() => undefined)
}
