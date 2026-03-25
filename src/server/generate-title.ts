import { QuickResponseAdapter } from "./quick-response"

const LOG_PREFIX = "[kanna:title]"

const TITLE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
  },
  required: ["title"],
  additionalProperties: false,
} as const

function normalizeGeneratedTitle(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 80)
  if (!normalized || normalized === "New Chat") return null
  return normalized
}

export async function generateTitleForChat(
  messageContent: string,
  cwd: string,
  adapter = new QuickResponseAdapter()
): Promise<string | null> {
  console.log(`${LOG_PREFIX} generating title`, {
    cwd,
    messagePreview: messageContent.replace(/\s+/g, " ").trim().slice(0, 120),
  })

  const result = await adapter.generateStructured<string>({
    cwd,
    task: "conversation title generation",
    prompt: `Generate a short, descriptive title (under 30 chars) for a conversation that starts with this message.\n\n${messageContent}`,
    schema: TITLE_SCHEMA,
    parse: (value) => {
      const output = value && typeof value === "object" ? value as { title?: unknown } : {}
      return normalizeGeneratedTitle(output.title)
    },
  })

  if (result) {
    console.log(`${LOG_PREFIX} generated title`, { title: result })
  } else {
    console.warn(`${LOG_PREFIX} no title generated`)
  }

  return result
}
