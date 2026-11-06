import type { Server } from 'node:http'

/** Slot ids are 16 random bytes in hex. A recovered id must still look like one to be adopted. */
export const CLAUDE_AUTH_PROXY_SLOT_ID = /^[0-9a-f]{32}$/

function listenOnce(server: Server, port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const fail = (error: Error): void => {
      server.off('listening', ready)
      reject(error)
    }
    const ready = (): void => {
      server.off('error', fail)
      resolve()
    }
    server.once('error', fail)
    server.once('listening', ready)
    server.listen(port, host)
  })
}

/**
 * A PTY that outlived the previous listener still has `127.0.0.1:<old port>/p/<slot>/` baked into
 * its env. Asking for that port again lets the slot work after a restart. A taken port falls back
 * to an ephemeral one, and those panes resume on the next move instead.
 */
export async function listenClaudeAuthProxy(
  server: Server,
  host: string,
  preferredPort: number | null | undefined
): Promise<void> {
  if (preferredPort) {
    try {
      await listenOnce(server, preferredPort, host)
      return
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'EADDRINUSE' && code !== 'EACCES') {
        throw error
      }
    }
  }
  await listenOnce(server, 0, host)
}
