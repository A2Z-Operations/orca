import { useEffect, useState } from 'react'

/** Wall clock for "9 minutes ago", refreshed every 30 s while the caller is mounted. */
export function useHalfMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}
