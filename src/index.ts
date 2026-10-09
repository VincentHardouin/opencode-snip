import { execFile } from "node:child_process"
import { Plugin } from "@opencode/plugin"

const SNIP_WRAPPER = /"[^"\r\n]*[\\/]snip(?:\.exe)?" run -- /gi

// Delegates to `snip hook` (Claude Code PreToolUse format) so the rewrite rules
// stay in snip: only filtered commands are wrapped, pipes/redirects/heredocs and
// command substitutions are left raw. Any failure leaves the command untouched.
export function rewrite(command: string, shell: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = execFile("snip", ["hook"], { timeout: 2000 }, (error, stdout) => {
      if (error || !stdout.trim()) return resolve(undefined)
      try {
        const rewritten = JSON.parse(stdout).hookSpecificOutput?.updatedInput?.command
        if (typeof rewritten !== "string") return resolve(undefined)
        if (/^(?:.*[\\/])?(?:pwsh|powershell)(?:\.exe)?$/i.test(shell)) {
          // Replace quoted paths (which need PowerShell's invocation operator) with bare snip.
          // This avoids doubled path escapes and assumes snip is on the shell PATH.
          if (command.match(SNIP_WRAPPER)) return resolve(undefined)
          resolve(rewritten.replace(SNIP_WRAPPER, "snip run -- "))
          return
        }
        resolve(rewritten)
      } catch {
        resolve(undefined)
      }
    })
    child.stdin?.on("error", () => {})
    child.stdin?.end(JSON.stringify({ tool_name: "Bash", tool_input: { command } }))
  })
}

export const shellCreateBefore = async (event: { command: string; shell: string }) => {
  if (!event.command) return
  const rewritten = await rewrite(event.command, event.shell)
  if (rewritten) event.command = rewritten
}

export const SnipPlugin = Plugin.define({
  id: "opencode-snip",
  async setup(ctx) {
    // Probes `snip hook` rather than the binary alone: a snip without the hook
    // subcommand would otherwise leave every command unfiltered silently.
    if (!(await rewrite("git status", "bash"))) {
      console.warn("[snip] snip hook unavailable (binary missing or too old) — plugin disabled")
      return
    }
    const registration = await ctx.shell.hook("create.before", shellCreateBefore)
    return () => registration.dispose()
  },
})

export default SnipPlugin
