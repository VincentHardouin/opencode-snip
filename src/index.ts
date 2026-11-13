import { execFile } from "node:child_process"
import { Plugin } from "@opencode/plugin"

// Delegates to `snip hook` (Claude Code PreToolUse format) so the rewrite rules
// stay in snip: only filtered commands are wrapped, pipes/redirects/heredocs and
// command substitutions are left raw. Any failure leaves the command untouched.
export function rewrite(command: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = execFile("snip", ["hook"], { timeout: 2000 }, (error, stdout) => {
      if (error || !stdout.trim()) return resolve(undefined)
      try {
        const rewritten = JSON.parse(stdout).hookSpecificOutput?.updatedInput?.command
        resolve(typeof rewritten === "string" ? rewritten : undefined)
      } catch {
        resolve(undefined)
      }
    })
    child.stdin?.on("error", () => {})
    child.stdin?.end(JSON.stringify({ tool_name: "Bash", tool_input: { command } }))
  })
}

// OpenCode's shell tool runs PowerShell on Windows, where a quoted executable
// path is a parse error unless it is preceded by the call operator:
//   "C:\...\snip.exe" run -- git status      -> ParserError
//   & "C:\...\snip.exe" run -- git status    -> works
// Compound commands are wrapped segment by segment, so every segment needs the
// operator, and an already prefixed command must be left alone.
const SNIP_INVOCATION = /(^|&&\s*|\|\|\s*|;\s*)(?="[^"]*snip(?:\.exe)?" run\b)/g

export function forPowerShell(command: string): string {
  return command.replace(SNIP_INVOCATION, "$1& ")
}

export const toolExecuteBefore = async (event: { tool: string; input: unknown }) => {
  if (event.tool !== "shell") return

  const input = event.input as { command?: unknown } | undefined
  const command = input?.command
  if (!command || typeof command !== "string") return

  const rewritten = await rewrite(command)
  if (!rewritten) return
  event.input = { ...input, command: process.platform === "win32" ? forPowerShell(rewritten) : rewritten }
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
