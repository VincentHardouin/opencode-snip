import { execFile } from "node:child_process"
import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { shellCreateBefore } from "./index"

const execFileAsync = promisify(execFile)
const windowsOnly = describe.skipIf(process.platform !== "win32")
const commandTimeout = 15_000
const originalPath = process.env.PATH
let tempRoot: string
let toolsDir: string
let pwshPath: string

async function run(file: string, args: string[], options: Parameters<typeof execFileAsync>[2] = {}) {
  return execFileAsync(file, args, { encoding: "utf8", timeout: commandTimeout, windowsHide: true, ...options } as Parameters<typeof execFileAsync>[2] & { encoding: "utf8" })
}

async function runHook(cwd: string, command: string) {
  return new Promise<string>((resolve, reject) => {
    const child = execFile("snip", ["hook"], { cwd, timeout: commandTimeout, windowsHide: true }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
    child.stdin?.end(JSON.stringify({ tool_name: "Bash", tool_input: { command } }))
  })
}

windowsOnly("Windows shell integration", () => {
  beforeAll(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "opencode snip integration "))
    toolsDir = join(tempRoot, "snip tools")
    await mkdir(toolsDir)

    const where = await run("where.exe", ["snip"])
    const sourceSnip = where.stdout.split(/\r?\n/).find((path) => path.toLowerCase().endsWith("snip.exe"))
    if (!sourceSnip) throw new Error("snip.exe was not found on PATH; install snip before running Windows integration tests")
    const snipPath = join(toolsDir, "snip.exe")
    await copyFile(sourceSnip, snipPath)

    const pwsh = await run("where.exe", ["pwsh"])
    pwshPath = pwsh.stdout.split(/\r?\n/).find((path) => /[\\/]pwsh(?:\.exe)?$/i.test(path)) ?? ""
    if (!pwshPath) throw new Error("pwsh.exe was not found on PATH; install PowerShell 7 before running Windows integration tests")

    process.env.PATH = `${toolsDir}${delimiter}${originalPath ?? ""}`
  }, commandTimeout * 2)

  afterAll(async () => {
    process.env.PATH = originalPath
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  it("executes snip hook rewrites in PowerShell with paths containing spaces", async () => {
    const repo = join(tempRoot, "fixture repo")
    await mkdir(repo)
    await run("git", ["init", "--quiet"], { cwd: repo })
    await writeFile(join(repo, "snip-integration-marker.txt"), "untracked fixture\n")

    const command = "git status --short"
    const hook = await runHook(repo, command)
    const hookCommand = JSON.parse(hook).hookSpecificOutput?.updatedInput?.command
    expect(hookCommand).toMatch(/^"[^"\r\n]* [^"\r\n]*[\\/]snip\.exe" run -- git status --short$/i)

    const event = { command, shell: pwshPath }
    await shellCreateBefore(event)
    expect(event.command).toBe("snip run -- git status --short")

    const result = await run(pwshPath, ["-NoProfile", "-NonInteractive", "-Command", event.command], { cwd: repo })
    // execFile's promise resolves only when the child exits successfully.
    expect(result.stdout).toContain("snip-integration-marker.txt")
    expect(result.stderr).not.toMatch(/ParserError/i)
  })

  it("executes both segments of a PowerShell 7 && chain", async () => {
    const repo = join(tempRoot, "chain fixture")
    await mkdir(repo)
    await run("git", ["init", "--quiet"], { cwd: repo })
    await writeFile(join(repo, "chain-marker.txt"), "untracked fixture\n")

    const command = "git status --short && git status --short"
    const event = { command, shell: pwshPath }
    await shellCreateBefore(event)
    expect(event.command.match(/snip run -- git status --short/g)).toHaveLength(2)

    const result = await run(pwshPath, ["-NoProfile", "-NonInteractive", "-Command", event.command], { cwd: repo })
    // execFile's promise resolves only when the child exits successfully.
    expect(result.stdout.match(/chain-marker\.txt/g)).toHaveLength(2)
    expect(result.stderr).not.toMatch(/ParserError/i)
  })
})
