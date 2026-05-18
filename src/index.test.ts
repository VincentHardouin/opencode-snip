import { describe, it, expect, beforeEach } from "vitest"
import { createToolExecuteBefore, hasSnipSubcommands } from "./index"

const mockedWrap = async () => true

describe("toolExecuteBefore", () => {
  let mockInput: { tool: string; sessionID: string; callID: string }
  let mockOutput: { args: { command: string } }

  beforeEach(() => {
    mockInput = { tool: "bash", sessionID: "s", callID: "c" }
    mockOutput = { args: { command: "" } }
  })

  it("should prefix simple command with snip run --", async () => {
    mockOutput.args.command = "go test ./..."
    await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- go test ./...")
  })

  it("should handle command with one env var prefix", async () => {
    mockOutput.args.command = "CGO_ENABLED=0 go test ./..."
    await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("CGO_ENABLED=0 snip run -- go test ./...")
  })

  it("should handle command with multiple env var prefixes", async () => {
    mockOutput.args.command = "CGO_ENABLED=0 GOOS=linux go test ./..."
    await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("CGO_ENABLED=0 GOOS=linux snip run -- go test ./...")
  })

  it("should handle command with &&", async () => {
    mockOutput.args.command = "go test && go build"
    await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- go test && snip run -- go build")
  })

  it("should handle command with |", async () => {
    mockOutput.args.command = "git log | head"
    await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- git log | snip run -- head")
  })

  it("should handle command with ;", async () => {
    mockOutput.args.command = "go test; go build"
    await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- go test; snip run -- go build")
  })

  it("should handle command with ||", async () => {
    mockOutput.args.command = "test -f foo.txt || echo missing"
    await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- test -f foo.txt || snip run -- echo missing")
  })

  it("should handle command with &", async () => {
    mockOutput.args.command = "sleep 1 & sleep 2 &"
    await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- sleep 1 & snip run -- sleep 2 &")
  })

  it("should handle mixed operators", async () => {
    mockOutput.args.command = "go test && go build; go run"
    await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- go test && snip run -- go build; snip run -- go run")
  })

  it("should handle env vars with operators", async () => {
    mockOutput.args.command = "FOO=bar go test && go build"
    await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("FOO=bar snip run -- go test && snip run -- go build")
  })

  it("should not double prefix already prefixed command", async () => {
    mockOutput.args.command = "snip run -- go test"
    await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip run -- go test")
  })

  it("should not modify non-bash tool calls", async () => {
    mockInput.tool = "read"
    mockOutput.args.command = "go test"
    await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("go test")
  })

  describe("subcommand passthrough", () => {
    it("should pass each pipe segment to shouldWrap", async () => {
      const called: string[] = []
      const spy = async (c: string) => { called.push(c); return true }
      mockOutput.args.command = "git log | head"
      await createToolExecuteBefore(spy)(mockInput, mockOutput)
      expect(called).toEqual(["git log", "head"])
    })

    it("should pass each && segment to shouldWrap", async () => {
      const called: string[] = []
      const spy = async (c: string) => { called.push(c); return true }
      mockOutput.args.command = "cd /tmp && go test"
      await createToolExecuteBefore(spy)(mockInput, mockOutput)
      expect(called).toEqual(["cd /tmp", "go test"])
    })

    it("should pass mixed operator segments to shouldWrap", async () => {
      const called: string[] = []
      const spy = async (c: string) => { called.push(c); return true }
      mockOutput.args.command = "go test && go build; go run"
      await createToolExecuteBefore(spy)(mockInput, mockOutput)
      expect(called).toEqual(["go test", "go build", "go run"])
    })

    it("should not call shouldWrap for already prefixed command", async () => {
      const called: string[] = []
      const spy = async (c: string) => { called.push(c); return true }
      mockOutput.args.command = "snip run -- go test"
      await createToolExecuteBefore(spy)(mockInput, mockOutput)
      expect(called).toEqual([])
    })

    it("should not call shouldWrap for already prefixed segments in compound command", async () => {
      const called: string[] = []
      const spy = async (c: string) => { called.push(c); return true }
      mockOutput.args.command = "cd /tmp && snip run -- go test"
      await createToolExecuteBefore(spy)(mockInput, mockOutput)
      expect(called).toEqual(["cd /tmp"])
    })
  })

  describe("redirections with &", () => {
    it("should not break 2>&1 redirection", async () => {
      mockOutput.args.command = "find / -name \"*.log\" 2>&1"
      await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- find / -name \"*.log\" 2>&1")
    })

    it("should not break 1>&2 redirection", async () => {
      mockOutput.args.command = "cmd 1>&2"
      await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cmd 1>&2")
    })

    it("should handle 2>&1 with pipe", async () => {
      mockOutput.args.command = "find / -name \"*.log\" 2>&1 | grep error"
      await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- find / -name \"*.log\" 2>&1 | snip run -- grep error")
    })

    it("should handle 2>&1 with chained commands", async () => {
      mockOutput.args.command = "cmd1 2>&1 && cmd2"
      await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cmd1 2>&1 && snip run -- cmd2")
    })
  })

  describe("pipe expressions with quotes", () => {
    it("should not split pipes inside single quotes", async () => {
      mockOutput.args.command = "cat file.json | jq '.content | .text'"
      await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cat file.json | snip run -- jq '.content | .text'")
    })

    it("should not split pipes inside double quotes", async () => {
      mockOutput.args.command = 'cat file.json | jq ".content | .text"'
      await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('snip run -- cat file.json | snip run -- jq ".content | .text"')
    })

    it("should handle jq with fromjson", async () => {
      mockOutput.args.command = "cat file.json | jq '.content[0].text | fromjson'"
      await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cat file.json | snip run -- jq '.content[0].text | fromjson'")
    })

    it("should handle multiple pipes in jq", async () => {
      mockOutput.args.command = "cat file.json | jq '.a | .b | .c'"
      await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cat file.json | snip run -- jq '.a | .b | .c'")
    })

    it("should handle pipe with || operator", async () => {
      mockOutput.args.command = "cmd1 || cmd2"
      await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cmd1 || snip run -- cmd2")
    })

    it("should handle mixed quotes and pipes", async () => {
      mockOutput.args.command = 'echo "hello | world" | cat'
      await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('snip run -- echo "hello | world" | snip run -- cat')
    })
  })

  describe("error guard", () => {
    it("should leave command unmodified when shouldWrap throws", async () => {
      const throwWrap = async () => { throw new Error("boom") }
      mockOutput.args.command = "go test ./..."
      await createToolExecuteBefore(throwWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("go test ./...")
    })

    it("should leave command unmodified when shouldWrap throws for compound commands", async () => {
      const throwWrap = async () => { throw new Error("boom") }
      mockOutput.args.command = "go test && go build"
      await createToolExecuteBefore(throwWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("go test && go build")
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

  describe("already-prefixed segments in compound commands", () => {
    it("should not double-prefix snip run -- in && chain", async () => {
      mockOutput.args.command = "cd /tmp && snip run -- go test"
      await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cd /tmp && snip run -- go test")
    })

    it("should not double-prefix snip run -- with env vars", async () => {
      mockOutput.args.command = "FOO=bar snip run -- go test"
      await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("FOO=bar snip run -- go test")
    })

    it("should not double-prefix snip run -- in pipe chain", async () => {
      mockOutput.args.command = "cd /tmp && snip run -- go test | ls"
      await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cd /tmp && snip run -- go test | snip run -- ls")
    })

    it("should not double-prefix snip run -- in complex chain with 2>&1", async () => {
      mockOutput.args.command = "cd /tmp && snip run -- go test 2>&1 | ls"
      await createToolExecuteBefore(mockedWrap)(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("snip run -- cd /tmp && snip run -- go test 2>&1 | snip run -- ls")
    })
  })
})

describe("hasSnipSubcommands", () => {
  it("should return true when snip check succeeds", async () => {
    const mock$ = ((...args: any[]) => ({
      nothrow: () => ({
        quiet: async () => ({ exitCode: 0 })
      })
    })) as any
    expect(await hasSnipSubcommands(mock$)).toBe(true)
  })

  it("should return true even when snip check exits non-zero (filter exists, cmd has no filter)", async () => {
    const mock$ = ((...args: any[]) => ({
      nothrow: () => ({
        quiet: async () => ({ exitCode: 1 })
      })
    })) as any
    expect(await hasSnipSubcommands(mock$)).toBe(true)
  })

  it("should return false when snip check subcommand is missing", async () => {
    const mock$ = ((...args: any[]) => ({
      nothrow: () => ({
        quiet: async () => { throw new Error("not found") }
      })
    })) as any
    expect(await hasSnipSubcommands(mock$)).toBe(false)
  })
})
