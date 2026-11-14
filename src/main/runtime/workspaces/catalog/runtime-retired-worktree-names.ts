import type { Repo } from '../../../../shared/repo-types'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import {
  getRetiredNameRegistryForRepo,
  hasRetiredNameRegistryStore
} from '../../../workspaces/removal/retirement/worktree-name-retirement'

function emptyRetiredNames(): {
  retiredNamesByRepo: Record<string, readonly string[]>
  retiredNameTiersByRepo: Record<string, number>
} {
  return { retiredNamesByRepo: {}, retiredNameTiersByRepo: {} }
}

export async function retiredWorktreeNamesForSelector(
  deps: {
    getStore(): RuntimeStore | null
    resolveRepo(selector: string): Promise<Repo>
  },
  repoSelector: string
): Promise<{
  retiredNamesByRepo: Record<string, readonly string[]>
  retiredNameTiersByRepo: Record<string, number>
}> {
  const store = deps.getStore()
  if (!store || !hasRetiredNameRegistryStore(store)) {
    return emptyRetiredNames()
  }
  const repo = await deps.resolveRepo(repoSelector)
  const registry = await getRetiredNameRegistryForRepo(
    store,
    repo,
    store.getRepos(),
    store.getSettings()
  )
  return {
    retiredNamesByRepo: { [repo.id]: registry.names },
    retiredNameTiersByRepo: { [repo.id]: registry.exhaustedTiers }
  }
}
