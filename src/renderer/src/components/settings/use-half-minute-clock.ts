import { useEffect, useState } from 'react'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'

/** Wall clock for "9 minutes ago", refreshed every 30 s while the caller is mounted and the window is visible. */
export function useHalfMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(
    () =>
      installWindowVisibilityInterval({
        run: () => setNow(Date.now()),
        runOnVisible: () => setNow(Date.now()),
        intervalMs: 30_000
      }),
    []
  )
  return now
}
