import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { TranscriptEntry } from "../shared/types"
import { EventStore } from "./event-store"
import { resolveLocalPath } from "./paths"

export interface ImportedCodexSession {
  id: string
  cwd: string
  filePath: string
  title: string
  createdAt: number
  updatedAt: number
  entries: TranscriptEntry[]
}

export interface CodexSessionImportResult {
  scanned: number
  imported: number
  skipped: number
}

interface CodexRecord {
  timestamp?: unknown
  type?: unknown
  payload?: unknown
}

function collectCodexSessionFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectCodexSessionFiles(fullPath))
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(fullPath)
    }
  }
  return files
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function timestampMs(value: unknown) {
  if (typeof value !== "string") return Number.NaN
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.NaN : parsed
}

function firstFiniteTimestamp(...values: number[]) {
  return values.find((value) => Number.isFinite(value)) ?? Date.now()
}

function isStandaloneCliSession(payload: Record<string, unknown>) {
  const originator = typeof payload.originator === "string" ? payload.originator : null
  const source = payload.source

  if (originator && originator !== "codex-tui") {
    return false
  }
  if (source !== undefined && source !== null && source !== "cli") {
    return false
  }
  return true
}

function isHomeSession(cwd: string, homeDir: string) {
  try {
    return resolveLocalPath(cwd) === resolveLocalPath(homeDir)
  } catch {
    return false
  }
}

function extractTextContent(content: unknown) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  return content
    .map((block) => {
      const record = asRecord(block)
      if (!record) return ""
      const text = record.text
      return typeof text === "string" ? text : ""
    })
    .filter(Boolean)
    .join("\n")
}

function isSyntheticUserMessage(text: string) {
  const trimmed = text.trim()
  return !trimmed
    || trimmed.startsWith("<environment_context>")
    || trimmed.startsWith("<turn_aborted>")
    || trimmed.startsWith("<system-message>")
}

function compactTitle(text: string) {
  const compact = text.replace(/\s+/g, " ").trim()
  if (!compact) return ""
  return compact.length > 72 ? `${compact.slice(0, 69)}...` : compact
}

function fallbackSessionTitle(createdAt: number) {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return "Codex session"
  return `Codex ${date.toISOString().slice(0, 16).replace("T", " ")}`
}

function toTranscriptEntry(role: "user" | "assistant", text: string, createdAt: number): TranscriptEntry | null {
  if (role === "user" && isSyntheticUserMessage(text)) {
    return null
  }

  const trimmed = text.trim()
  if (!trimmed) return null

  if (role === "user") {
    return {
      _id: crypto.randomUUID(),
      createdAt,
      kind: "user_prompt",
      content: trimmed,
    }
  }

  return {
    _id: crypto.randomUUID(),
    createdAt,
    kind: "assistant_text",
    text: trimmed,
  }
}

function readCodexSession(filePath: string, homeDir: string): ImportedCodexSession | null {
  const fileStat = statSync(filePath)
  const lines = readFileSync(filePath, "utf8").split("\n")
  let sessionId: string | null = null
  let cwd: string | null = null
  let createdAt = Number.NaN
  let updatedAt = fileStat.mtimeMs
  let standaloneCliSession = false
  const responseEntries: TranscriptEntry[] = []
  const eventEntries: TranscriptEntry[] = []
  let firstUserPrompt = ""

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const record = parseJsonRecord(line) as CodexRecord | null
    if (!record) continue

    const recordTimestamp = timestampMs(record.timestamp)
    if (Number.isFinite(recordTimestamp)) {
      updatedAt = Math.max(updatedAt, recordTimestamp)
    }

    const payload = asRecord(record.payload)
    if (record.type === "session_meta" && payload) {
      sessionId = typeof payload.id === "string" ? payload.id : sessionId
      cwd = typeof payload.cwd === "string" ? payload.cwd : cwd
      standaloneCliSession = isStandaloneCliSession(payload)
      createdAt = firstFiniteTimestamp(
        timestampMs(payload.timestamp),
        recordTimestamp,
        fileStat.birthtimeMs,
        fileStat.mtimeMs
      )
      continue
    }

    if (!payload) continue
    const entryCreatedAt = firstFiniteTimestamp(recordTimestamp, updatedAt, fileStat.mtimeMs)
    if (record.type === "response_item" && payload.type === "message") {
      const role = payload.role === "user" || payload.role === "assistant" ? payload.role : null
      if (!role) continue
      const text = extractTextContent(payload.content)
      const entry = toTranscriptEntry(role, text, entryCreatedAt)
      if (!entry) continue
      if (entry.kind === "user_prompt" && !firstUserPrompt) {
        firstUserPrompt = entry.content
      }
      responseEntries.push(entry)
      continue
    }

    if (record.type === "event_msg" && (payload.type === "user_message" || payload.type === "agent_message")) {
      const text = typeof payload.message === "string" ? payload.message : ""
      const role = payload.type === "user_message" ? "user" : "assistant"
      const entry = toTranscriptEntry(role, text, entryCreatedAt)
      if (!entry) continue
      if (entry.kind === "user_prompt" && !firstUserPrompt) {
        firstUserPrompt = entry.content
      }
      eventEntries.push(entry)
    }
  }

  if (!sessionId || !cwd || !standaloneCliSession || !isHomeSession(cwd, homeDir)) {
    return null
  }

  const entries = responseEntries.length > 0 ? responseEntries : eventEntries
  if (entries.length === 0) {
    return null
  }

  const title = compactTitle(firstUserPrompt) || fallbackSessionTitle(createdAt)
  return {
    id: sessionId,
    cwd,
    filePath,
    title,
    createdAt,
    updatedAt,
    entries,
  }
}

export function scanStandaloneCodexSessions(homeDir: string = homedir()) {
  const sessionsDir = path.join(homeDir, ".codex", "sessions")
  return collectCodexSessionFiles(sessionsDir)
    .map((filePath) => readCodexSession(filePath, homeDir))
    .filter((session): session is ImportedCodexSession => Boolean(session))
    .sort((left, right) => left.createdAt - right.createdAt)
}

export async function importStandaloneCodexSessions(
  store: EventStore,
  homeDir: string = homedir()
): Promise<CodexSessionImportResult> {
  const sessions = scanStandaloneCodexSessions(homeDir)
  let imported = 0
  let skipped = 0

  for (const session of sessions) {
    const result = await store.importCodexSessionChat({
      sessionToken: session.id,
      title: session.title,
      entries: session.entries,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      homeDir,
    })
    if (result.imported) {
      imported += 1
    } else {
      skipped += 1
    }
  }

  return {
    scanned: sessions.length,
    imported,
    skipped,
  }
}
