import { z } from 'zod'
import { claudeOAuthTokenFetch } from '../../rate-limits/claude-oauth-node-fetch'

const profile = z.object({
  account: z.object({ email: z.string().trim().min(1) }),
  organization: z.object({ uuid: z.string().trim().min(1) })
})

/** Ask the issuer about this exact opaque bearer, without following redirects or logging errors. */
export async function readClaudeBearerIdentity(token: string): Promise<{
  email: string
  organizationUuid: string
} | null> {
  try {
    const response = await claudeOAuthTokenFetch('https://api.anthropic.com/api/oauth/profile', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'claude-code/2.1.323'
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) {
      return null
    }
    const parsed = profile.safeParse(await response.json())
    return parsed.success
      ? { email: parsed.data.account.email, organizationUuid: parsed.data.organization.uuid }
      : null
  } catch {
    return null
  }
}
