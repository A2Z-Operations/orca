/** Consecutive failed sampler reads before one `pane-ownership-sampler-failing` line. */
export const SAMPLER_FAILURES_BEFORE_LOG = 10

/**
 * #44: the sampler's read health. Counts consecutive failed reads (the observer backs off on them), logs once when they
 * reach SAMPLER_FAILURES_BEFORE_LOG and once when a read succeeds again. Moved out of the observer to keep it small.
 */
export class SamplerHealth {
  failures = 0
  private failingLogged = false

  constructor(private readonly log: (event: string, details: Record<string, unknown>) => void) {}

  failure(error: unknown): void {
    this.failures += 1
    if (this.failures >= SAMPLER_FAILURES_BEFORE_LOG && !this.failingLogged) {
      this.failingLogged = true
      this.log('pane-ownership-sampler-failing', { failures: this.failures, error: String(error) })
    }
  }

  success(): void {
    if (this.failingLogged) {
      this.log('pane-ownership-sampler-recovered', { afterFailures: this.failures })
    }
    this.failures = 0
    this.failingLogged = false
  }
}
