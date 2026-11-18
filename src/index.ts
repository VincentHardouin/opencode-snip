import { execFile } from "node:child_process"
import { Plugin } from "@opencode/plugin"

// OpenCode's `cmd` shell escapes double quotes before handing a command to
// cmd.exe, so a quoted launcher path arrives as \"C:\...\snip.exe\" and fails
// with "is not recognized". Quoting is only needed when the path contains
// whitespace, so drop the quotes when it does not.
const QUOTED_LAUNCHER = /"([^"\s]+)"(?=\s+run --\s)/g

export function unquoteLauncher(command: string): string {
  return command.replace(QUOTED_LAUNCHER, "$1")
}

// Delegates to `snip hook` (Claude Code PreToolUse format) so the rewrite rules
// stay in snip: only filtered commands are wrapped, pipes/redirects/heredocs and
// command substitutions are left raw. Any failure leaves the command untouched.
export function rewrite(command: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = execFile("snip", ["hook"], { timeout: 2000, windowsHide: true }, (error, stdout) => {
      if (error || !stdout.trim()) return resolve(undefined)
      try {
        const rewritten = JSON.parse(stdout).hookSpecificOutput?.updatedInput?.command
        resolve(typeof rewritten === "string" ? unquoteLauncher(rewritten) : undefined)
      } catch {
        resolve(undefined)
      }
    })
    child.stdin?.on("error", () => {})
    child.stdin?.end(JSON.stringify({ tool_name: "Bash", tool_input: { command } }))
  })
}

export const toolExecuteBefore = async (event: { tool: string; input: unknown }) => {
  if (event.tool !== "shell") return

  const input = event.input as { command?: unknown } | undefined
  const command = input?.command
  if (!command || typeof command !== "string") return

  const rewritten = await rewrite(command)
  if (rewritten) event.input = { ...input, command: rewritten }
}

export const SnipPlugin = Plugin.define({
  id: "opencode-snip",
  async setup(ctx) {
    // Probes `snip hook` rather than the binary alone: a snip without the hook
    // subcommand would otherwise leave every command unfiltered silently.
    if (!(await rewrite("git status"))) {
      console.warn("[snip] snip hook unavailable (binary missing or too old) — plugin disabled")
      return
    }
    const registration = await ctx.tool.hook("execute.before", toolExecuteBefore)
    return () => registration.dispose()
  },
})

export default SnipPlugin
