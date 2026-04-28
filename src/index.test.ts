import { describe, it, expect, beforeEach } from "vitest"
import { createToolExecuteBefore } from "./index"

const WRAPPED_COMMANDS = new Set([
  "go test ./...",
  "git log",
  "docker build -t app .",
  "git log -10",
  "find / -name \"*.log\" 2>&1",
  "cmd 1>&2",
  "find / -name \"*.log\" 2>&1 | grep error",
  "cmd1 2>&1 && cmd2",
  "cat file.json | jq '.content | .text'",
  "cat file.json | jq \".content | .text\"",
  "cat file.json | jq '.content[0].text | fromjson'",
  "cat file.json | jq '.a | .b | .c'",
  "echo \"hello | world\" | cat",
  "go build",
  "go run",
  "ls",
  "sleep 1",
  "sleep 2",
  "test -f foo.txt",
  "echo missing",
  "cmd",
  "cmd1",
  "cmd2",
  "go test",
  "cat",
  "cat file.json",
  "echo",
  "head",
  "grep",
  "find",
  "jq",
])

async function defaultShouldWrap(cmd: string): Promise<boolean> {
  const baseCmd = cmd.split(/\s+/)[0]
  return WRAPPED_COMMANDS.has(cmd) || WRAPPED_COMMANDS.has(baseCmd)
}

describe("toolExecuteBefore", () => {
  let mockInput: { tool: string; sessionID: string; callID: string }
  let mockOutput: { args: { command: string } }

  beforeEach(() => {
    mockInput = { tool: "bash", sessionID: "s", callID: "c" }
    mockOutput = { args: { command: "" } }
  })

  it("should prefix simple command with snip run --", async () => {
    mockOutput.args.command = "go test ./..."
    await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- go test ./...")
  })

  it("should handle command with one env var prefix", async () => {
    mockOutput.args.command = "CGO_ENABLED=0 go test ./..."
    await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("CGO_ENABLED=0 snip run -- go test ./...")
  })

  it("should handle command with multiple env var prefixes", async () => {
    mockOutput.args.command = "CGO_ENABLED=0 GOOS=linux go test ./..."
    await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("CGO_ENABLED=0 GOOS=linux snip run -- go test ./...")
  })

  it("should handle command with &&", async () => {
    mockOutput.args.command = "go test && go build"
    await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- go test && snip run -- go build")
  })

  it("should handle command with |", async () => {
    mockOutput.args.command = "git log | head"
    await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- git log | head")
  })

  it("should handle command with ;", async () => {
    mockOutput.args.command = "go test; go build"
    await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- go test; snip run -- go build")
  })

  it("should handle command with ||", async () => {
    mockOutput.args.command = "test -f foo.txt || echo missing"
    await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- test -f foo.txt || snip run -- echo missing")
  })

  it("should handle command with &", async () => {
    mockOutput.args.command = "sleep 1 & sleep 2 &"
    await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- sleep 1 & snip run -- sleep 2 &")
  })

  it("should handle mixed operators", async () => {
    mockOutput.args.command = "go test && go build; go run"
    await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- go test && snip run -- go build; snip run -- go run")
  })

  it("should handle env vars with operators", async () => {
    mockOutput.args.command = "FOO=bar go test && go build"
    await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("FOO=bar snip run -- go test && snip run -- go build")
  })

  it("should not double prefix already prefixed command", async () => {
    mockOutput.args.command = "snip run -- go test"
    await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- go test")
  })

  it("should not modify non-bash tool calls", async () => {
    mockInput.tool = "read"
    mockOutput.args.command = "go test"
    await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("go test")
  })

  describe("commands that should not be wrapped", () => {
    it("should skip cd when shouldWrap returns false", async () => {
      const shouldSkip = async (cmd: string) => !cmd.startsWith("cd ")
      mockOutput.args.command = "cd /tmp"
      await createToolExecuteBefore(shouldSkip)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("cd /tmp")
    })

    it("should skip source when shouldWrap returns false", async () => {
      const shouldSkip = async (cmd: string) => !cmd.startsWith("source ")
      mockOutput.args.command = "source ~/.bashrc"
      await createToolExecuteBefore(shouldSkip)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("source ~/.bashrc")
    })

    it("should skip . (dot) when shouldWrap returns false", async () => {
      const shouldSkip = async (cmd: string) => !cmd.startsWith(". ")
      mockOutput.args.command = ". ./env.sh"
      await createToolExecuteBefore(shouldSkip)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe(". ./env.sh")
    })

    it("should skip export when shouldWrap returns false", async () => {
      const shouldSkip = async (cmd: string) => !cmd.startsWith("export ")
      mockOutput.args.command = "export FOO=bar"
      await createToolExecuteBefore(shouldSkip)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("export FOO=bar")
    })

    it("should skip alias when shouldWrap returns false", async () => {
      const shouldSkip = async (cmd: string) => !cmd.startsWith("alias ")
      mockOutput.args.command = 'alias ll="ls -la"'
      await createToolExecuteBefore(shouldSkip)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('alias ll="ls -la"')
    })

    it("should skip unset when shouldWrap returns false", async () => {
      const shouldSkip = async (cmd: string) => !cmd.startsWith("unset ")
      mockOutput.args.command = "unset VAR"
      await createToolExecuteBefore(shouldSkip)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("unset VAR")
    })

    it("should skip export with env var prefix when shouldWrap returns false", async () => {
      const shouldSkip = async (cmd: string) => {
        const bare = cmd.replace(/^[A-Za-z_][A-Za-z0-9_]*=[^\s]* +/, "")
        return !bare.startsWith("export ")
      }
      mockOutput.args.command = "CGO_ENABLED=0 export FOO=bar"
      await createToolExecuteBefore(shouldSkip)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("CGO_ENABLED=0 export FOO=bar")
    })

    it("should skip cd but wrap chained command via shouldWrap", async () => {
      const shouldSkip = async (cmd: string) => !cmd.startsWith("cd ")
      mockOutput.args.command = "cd /tmp && ls"
      await createToolExecuteBefore(shouldSkip)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("cd /tmp && snip run -- ls")
    })
  })

  describe("redirections with &", () => {
    it("should not break 2>&1 redirection", async () => {
      mockOutput.args.command = "find / -name \"*.log\" 2>&1"
      await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- find / -name \"*.log\" 2>&1")
    })

    it("should not break 1>&2 redirection", async () => {
      mockOutput.args.command = "cmd 1>&2"
      await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cmd 1>&2")
    })

    it("should handle 2>&1 with pipe", async () => {
      mockOutput.args.command = "find / -name \"*.log\" 2>&1 | grep error"
      await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- find / -name \"*.log\" 2>&1 | grep error")
    })

    it("should handle 2>&1 with chained commands", async () => {
      mockOutput.args.command = "cmd1 2>&1 && cmd2"
      await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cmd1 2>&1 && snip run -- cmd2")
    })
  })

  describe("pipe expressions with quotes", () => {
    it("should not split pipes inside single quotes", async () => {
      mockOutput.args.command = "cat file.json | jq '.content | .text'"
      await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cat file.json | jq '.content | .text'")
    })

    it("should not split pipes inside double quotes", async () => {
      mockOutput.args.command = 'cat file.json | jq ".content | .text"'
      await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('snip run -- cat file.json | jq ".content | .text"')
    })

    it("should handle jq with fromjson", async () => {
      mockOutput.args.command = "cat file.json | jq '.content[0].text | fromjson'"
      await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cat file.json | jq '.content[0].text | fromjson'")
    })

    it("should handle multiple pipes in jq", async () => {
      mockOutput.args.command = "cat file.json | jq '.a | .b | .c'"
      await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cat file.json | jq '.a | .b | .c'")
    })

    it("should handle pipe with || operator", async () => {
      mockOutput.args.command = "cmd1 || cmd2"
      await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cmd1 || snip run -- cmd2")
    })

    it("should handle mixed quotes and pipes", async () => {
      mockOutput.args.command = 'echo "hello | world" | cat'
      await createToolExecuteBefore(defaultShouldWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('snip run -- echo "hello | world" | cat')
    })
  })

  describe("mixed wrapping in compound commands", () => {
    it("should wrap only segments that shouldWrap approves", async () => {
      const selectiveWrap = async (cmd: string) => !cmd.startsWith("cd ")
      mockOutput.args.command = "cd /tmp && go test"
      await createToolExecuteBefore(selectiveWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("cd /tmp && snip run -- go test")
    })

    it("should skip all segments when shouldWrap always returns false", async () => {
      const neverWrap = async () => false
      mockOutput.args.command = "go test && go build"
      await createToolExecuteBefore(neverWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("go test && go build")
    })
  })
})