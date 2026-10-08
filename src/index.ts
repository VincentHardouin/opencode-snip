// Port to the OpenCode V2 plugin API. OpenCode V2 rejects V1 hook objects
// ("Plugin must export a default definition with an id and a setup function"),
// so this version registers the equivalent V2 hook instead:
//
//   V1 tool.execute.before (bash) -> V2 ctx.tool.hook("execute.before")
//
// (the V2 ctx.shell.hook("create.before") hook is NOT invoked for shell tool
// executions in OpenCode 2.0.x — verified empirically — so the tool hook is
// the only reliable interception point).
//
// Delegates to `snip hook` (Claude Code PreToolUse format) so the rewrite rules
// stay in snip: only filtered commands are wrapped, pipes/redirects/heredocs and
// command substitutions are left raw. Any failure leaves the command untouched.
import { execFile } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import * as os from "node:os"
import * as path from "node:path"

const DIR = path.dirname(fileURLToPath(import.meta.url))

// Prefer a snip binary shipped next to the plugin (no PATH dependency),
// then one at the package root, then plain `snip` from PATH.
export function snipBin(): string {
  if (existsSync(path.join(DIR, "snip.exe"))) return path.join(DIR, "snip.exe")
  if (existsSync(path.join(DIR, "..", "snip.exe"))) return path.join(DIR, "..", "snip.exe")
  return "snip"
}

export function rewrite(command: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = execFile(snipBin(), ["hook"], { timeout: 2000 }, (error, stdout) => {
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

// Reads the OpenCode `shell` setting ("Default shell to use for terminal and
// bash tool") from the given config files, first hit wins (project config
// paths come before global ones). JSONC comments and trailing commas are
// stripped best-effort; any failure returns undefined.
export function readShellConfig(paths: string[]): string | undefined {
  for (const p of paths) {
    try {
      const raw = readFileSync(p, "utf-8")
      const json = JSON.parse(
        raw
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
          .replace(/,(\s*[}\]])/g, "$1"),
      )
      if (typeof json?.shell === "string") return json.shell
    } catch {
      /* try next */
    }
  }
  return undefined
}

// PowerShell needs `&` to invoke a quoted string; bash rejects it. Decide from
// the configured shell when known, else fall back to the platform default
// (OpenCode spawns powershell.exe on Windows).
export function shouldPrefixPS(shell: string | undefined, platform: string): boolean {
  if (shell) return /powershell|pwsh/i.test(shell)
  return platform === "win32"
}

// snip's quoting (`"snip.exe" run -- cmd`) is only parseable in PowerShell with
// a leading `&`. Prefix every wrapped segment — snip joins wrapped segments at
// command boundaries (`;`, `&&`), so quoted arguments mid-segment never match.
function psPrefix(command: string, isPS: boolean): string {
  if (!isPS) return command
  return command.replace(/(^|(?:&&|\|\||[;&])\s*)("[^"]*"\s+run\b)/g, "$1& $2")
}

export const SnipPlugin = {
  id: "opencode-snip",
  async setup(ctx: any) {
    // Same probe as V1: without a working `snip hook`, do nothing.
    if (!(await rewrite("git status"))) {
      console.warn("[snip] snip hook unavailable (missing or old binary) — plugin disabled")
      return {}
    }
    const directory = ctx?.location?.directory ?? process.cwd()
    const configPaths = [
      path.join(directory, ".opencode", "opencode.json"),
      path.join(directory, ".opencode", "opencode.jsonc"),
      path.join(os.homedir(), ".config", "opencode", "opencode.json"),
      path.join(os.homedir(), ".config", "opencode", "opencode.jsonc"),
    ]
    const isPS = shouldPrefixPS(readShellConfig(configPaths), process.platform)

    await ctx.tool.hook("execute.before", async (event: any) => {
      try {
        if (event.tool !== "shell" && event.tool !== "bash") return
        const args = event.input
        if (!args || typeof args !== "object" || typeof args.command !== "string" || !args.command)
          return
        const rewritten = await rewrite(args.command)
        if (rewritten) {
          args.command = psPrefix(rewritten, isPS)
          event.input = args
        }
      } catch {
        /* fail-open */
      }
    })
    return {}
  },
}

export default SnipPlugin
