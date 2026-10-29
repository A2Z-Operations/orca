export async function sweep(userDataPath: string): Promise<void> {
  const { sweepDurableJobResidueAtStartup } =
    await import('../claude/durable-background-job-plugin')
  sweepDurableJobResidueAtStartup(userDataPath)
}
