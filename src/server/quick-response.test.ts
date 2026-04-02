import { describe, expect, test } from "bun:test"
import { fallbackTitleFromMessage, generateTitleForChat, generateTitleForChatDetailed } from "./generate-title"
import { getQuickResponseWorkspace, QuickResponseAdapter } from "./quick-response"

describe("QuickResponseAdapter", () => {
  test("returns the Claude structured result when it validates", async () => {
    const adapter = new QuickResponseAdapter({
      runClaudeStructured: async () => ({ title: "Claude title" }),
      runCodexStructured: async () => ({ title: "Codex title" }),
    })

    const result = await adapter.generateStructured({
      cwd: "/tmp/project",
      task: "title generation",
      prompt: "Generate a title",
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
        },
        required: ["title"],
        additionalProperties: false,
      },
      parse: (value) => {
        const output = value && typeof value === "object" ? value as { title?: unknown } : {}
        return typeof output.title === "string" ? output.title : null
      },
    })

    expect(result).toBe("Claude title")
  })

  test("falls back to Codex when Claude fails validation", async () => {
    const adapter = new QuickResponseAdapter({
      runClaudeStructured: async () => ({ bad: true }),
      runCodexStructured: async () => ({ title: "Codex title" }),
    })

    const result = await adapter.generateStructured({
      cwd: "/tmp/project",
      task: "title generation",
      prompt: "Generate a title",
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
        },
        required: ["title"],
        additionalProperties: false,
      },
      parse: (value) => {
        const output = value && typeof value === "object" ? value as { title?: unknown } : {}
        return typeof output.title === "string" ? output.title : null
      },
    })

    expect(result).toBe("Codex title")
  })

  test("falls back to Codex when Claude throws", async () => {
    const adapter = new QuickResponseAdapter({
      runClaudeStructured: async () => {
        throw new Error("Not authenticated")
      },
      runCodexStructured: async () => ({ title: "Codex title" }),
    })

    const result = await adapter.generateStructured({
      cwd: "/tmp/project",
      task: "title generation",
      prompt: "Generate a title",
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
        },
        required: ["title"],
        additionalProperties: false,
      },
      parse: (value) => {
        const output = value && typeof value === "object" ? value as { title?: unknown } : {}
        return typeof output.title === "string" ? output.title : null
      },
    })

    expect(result).toBe("Codex title")
  })

  test("uses the Kanna app data root as the quick-response workspace", async () => {
    const previousProfile = process.env.KANNA_RUNTIME_PROFILE
    process.env.KANNA_RUNTIME_PROFILE = "dev"

    try {
      let claudeCwd = ""
      const adapter = new QuickResponseAdapter({
        runClaudeStructured: async (args) => {
          claudeCwd = args.cwd
          return { title: "Claude title" }
        },
      })

      await adapter.generateStructured({
        cwd: "/tmp/project",
        task: "title generation",
        prompt: "Generate a title",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
          required: ["title"],
          additionalProperties: false,
        },
        parse: (value) => {
          const output = value && typeof value === "object" ? value as { title?: unknown } : {}
          return typeof output.title === "string" ? output.title : null
        },
      })

      expect(claudeCwd).toBe(getQuickResponseWorkspace(process.env))
      expect(claudeCwd.endsWith("/.kanna-dev")).toBe(true)
    } finally {
      if (previousProfile === undefined) {
        delete process.env.KANNA_RUNTIME_PROFILE
      } else {
        process.env.KANNA_RUNTIME_PROFILE = previousProfile
      }
    }
  })

  test("uses gpt-5.4-mini for Codex title generation fallback", async () => {
    const requests: Array<{ cwd: string; prompt: string; model?: string }> = []
    const adapter = new QuickResponseAdapter({
      codexManager: {
        async generateStructured(args: { cwd: string; prompt: string; model?: string }) {
          requests.push(args)
          return "{\"title\":\"Codex title\"}"
        },
      } as never,
      runClaudeStructured: async () => null,
    })

    const result = await adapter.generateStructured({
      cwd: "/tmp/project",
      task: "title generation",
      prompt: "Generate a title",
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
        },
        required: ["title"],
        additionalProperties: false,
      },
      parse: (value) => {
        const output = value && typeof value === "object" ? value as { title?: unknown } : {}
        return typeof output.title === "string" ? output.title : null
      },
    })

    expect(result).toBe("Codex title")
    expect(requests).toHaveLength(1)
    expect(requests[0]?.model).toBe("gpt-5.4-mini")
  })
})

describe("generateTitleForChat", () => {
  test("sanitizes generated titles", async () => {
    const title = await generateTitleForChat(
      "hello",
      "/tmp/project",
      new QuickResponseAdapter({
        runClaudeStructured: async () => ({ title: "   Example\nTitle   " }),
      })
    )

    expect(title).toBe("Example Title")
  })

  test("rejects invalid generated titles", async () => {
    const title = await generateTitleForChat(
      "hello",
      "/tmp/project",
      new QuickResponseAdapter({
        runClaudeStructured: async () => ({ title: "   " }),
        runCodexStructured: async () => ({ title: "New Chat" }),
      })
    )

    expect(title).toBe("hello")
  })

  test("falls back to the first 35 characters of the message with ellipsis", async () => {
    const title = await generateTitleForChat(
      "This message is definitely longer than thirty five characters",
      "/tmp/project",
      new QuickResponseAdapter({
        runClaudeStructured: async () => {
          throw new Error("Not authenticated")
        },
        runCodexStructured: async () => null,
      })
    )

    expect(title).toBe("This message is definitely longer t...")
  })

  test("returns fallback metadata when providers fail", async () => {
    const result = await generateTitleForChatDetailed(
      "hello there",
      "/tmp/project",
      new QuickResponseAdapter({
        runClaudeStructured: async () => {
          throw new Error("Not authenticated")
        },
        runCodexStructured: async () => {
          throw new Error("Codex unavailable")
        },
      })
    )

    expect(result).toEqual({
      title: "hello there",
      usedFallback: true,
      failureMessage: "claude failed conversation title generation: Not authenticated; codex failed conversation title generation: Codex unavailable",
    })
  })
})

describe("fallbackTitleFromMessage", () => {
  test("normalizes whitespace", () => {
    expect(fallbackTitleFromMessage("  hello\n   world  ")).toBe("hello world")
  })

  test("returns null for blank input", () => {
    expect(fallbackTitleFromMessage("   \n  ")).toBeNull()
  })
})
