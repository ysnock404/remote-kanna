import { randomUUID } from "node:crypto"
import { mkdir, open, rm } from "node:fs/promises"
import path from "node:path"
import { fileTypeFromBuffer } from "file-type"
import type { ChatAttachment, RemoteHostConfig } from "../shared/types"
import { getProjectUploadDir } from "./paths"
import { remotePathExpression, runSsh, runSshWithInput, shellQuote } from "./remote-hosts"

const DEFAULT_BINARY_MIME_TYPE = "application/octet-stream"
const IMAGE_MIME_PREFIX = "image/"
const TEXT_PLAIN_CONTENT_TYPE = "text/plain; charset=utf-8"

const TEXT_CONTENT_TYPE_BY_EXTENSION = new Map<string, string>([
  [".csv", "text/csv; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jsonc", TEXT_PLAIN_CONTENT_TYPE],
  [".md", "text/markdown; charset=utf-8"],
  [".tsv", "text/tab-separated-values; charset=utf-8"],
])

const BINARY_CONTENT_TYPE_BY_EXTENSION = new Map<string, string>([
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
])

const TEXT_LIKE_EXTENSIONS = new Set([
  ".c", ".cc", ".cfg", ".conf", ".cpp", ".cs", ".css", ".env", ".go", ".graphql", ".h", ".hpp", ".html",
  ".ini", ".java", ".js", ".jsx", ".kt", ".lua", ".mjs", ".php", ".pl", ".properties", ".py", ".rb", ".rs",
  ".scss", ".sh", ".sql", ".swift", ".toml", ".ts", ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml", ".zsh",
])

function sanitizeFileName(fileName: string) {
  const baseName = path.basename(fileName).trim()
  const cleaned = baseName.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "")
  return cleaned || "upload"
}

function getUploadCandidateNames(originalName: string) {
  const sanitizedName = sanitizeFileName(originalName)
  const parsed = path.parse(sanitizedName)
  const extension = parsed.ext
  const name = parsed.name || "upload"

  return {
    first: sanitizedName,
    withCounter(counter: number) {
      return `${name}-${counter}${extension}`
    },
  }
}

function isValidStoredUploadName(storedName: string) {
  return Boolean(storedName)
    && !storedName.includes("/")
    && !storedName.includes("\\")
    && storedName !== "."
    && storedName !== ".."
}

async function getUploadMimeType(bytes: Uint8Array, fallbackMimeType?: string) {
  const detectedType = await fileTypeFromBuffer(bytes)
  return detectedType?.mime ?? fallbackMimeType ?? DEFAULT_BINARY_MIME_TYPE
}

function createUploadAttachment(args: {
  projectId: string
  fileName: string
  storedName: string
  absolutePath: string
  mimeType: string
  size: number
}): ChatAttachment {
  return {
    id: randomUUID(),
    kind: args.mimeType.startsWith(IMAGE_MIME_PREFIX) ? "image" : "file",
    displayName: args.fileName,
    absolutePath: args.absolutePath,
    relativePath: `./.kanna/uploads/${args.storedName}`,
    contentUrl: `/api/projects/${args.projectId}/uploads/${encodeURIComponent(args.storedName)}/content`,
    mimeType: args.mimeType,
    size: args.size,
  }
}

function getRemotePathConversionScript() {
  return String.raw`function toRemotePath(nativePath) {
  let resolved = String(nativePath);
  try {
    resolved = fs.realpathSync(nativePath);
  } catch {
    resolved = path.resolve(nativePath);
  }
  const backslash = String.fromCharCode(92);
  if (process.platform === "win32" && resolved.length >= 2 && resolved[1] === ":") {
    let rest = resolved.slice(2);
    while (rest.startsWith("/") || rest.startsWith(backslash)) {
      rest = rest.slice(1);
    }
    rest = rest.split(backslash).join("/");
    while (rest.includes("//")) {
      rest = rest.split("//").join("/");
    }
    return "/" + resolved[0].toLowerCase() + (rest ? "/" + rest : "");
  }
  return resolved.split(backslash).join("/");
}`
}

function getRemoteUploadScript(candidates: ReturnType<typeof getUploadCandidateNames>) {
  return String.raw`const fs = require("node:fs");
const path = require("node:path");
${getRemotePathConversionScript()}

const candidates = ${JSON.stringify({
  first: candidates.first,
  parsed: {
    extension: path.parse(candidates.first).ext,
    name: path.parse(candidates.first).name || "upload",
  },
})};
const input = fs.readFileSync(0, "utf8").trim();
const bytes = Buffer.from(input, "base64");
const uploadDir = path.join(process.cwd(), ".kanna", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

let storedName = candidates.first;
let absolutePath = path.join(uploadDir, storedName);
let counter = 1;

while (true) {
  try {
    const fd = fs.openSync(absolutePath, "wx");
    try {
      fs.writeFileSync(fd, bytes);
    } finally {
      fs.closeSync(fd);
    }
    break;
  } catch (error) {
    if (!error || error.code !== "EEXIST") {
      throw error;
    }
    storedName = candidates.parsed.name + "-" + counter + candidates.parsed.extension;
    absolutePath = path.join(uploadDir, storedName);
    counter += 1;
  }
}

console.log(JSON.stringify({ storedName, absolutePath: toRemotePath(absolutePath) }));`
}

function getRemoteReadUploadScript(storedName: string) {
  return String.raw`const fs = require("node:fs");
const path = require("node:path");
const storedName = ${JSON.stringify(storedName)};
const filePath = path.join(process.cwd(), ".kanna", "uploads", storedName);

try {
  const info = fs.statSync(filePath);
  if (!info.isFile()) {
    process.exit(3);
  }
  const bytes = fs.readFileSync(filePath);
  console.log(JSON.stringify({ base64: bytes.toString("base64") }));
} catch {
  process.exit(3);
}`
}

function getRemoteDeleteUploadScript(storedName: string) {
  return String.raw`const fs = require("node:fs");
const path = require("node:path");
const storedName = ${JSON.stringify(storedName)};
const filePath = path.join(process.cwd(), ".kanna", "uploads", storedName);

try {
  fs.rmSync(filePath, { force: true });
  console.log(JSON.stringify({ ok: true }));
} catch {
  console.log(JSON.stringify({ ok: false }));
}`
}

export async function persistProjectUpload(args: {
  projectId: string
  localPath: string
  fileName: string
  bytes: Uint8Array
  fallbackMimeType?: string
}): Promise<ChatAttachment> {
  const uploadDir = getProjectUploadDir(args.localPath)
  await mkdir(uploadDir, { recursive: true })

  const mimeType = await getUploadMimeType(args.bytes, args.fallbackMimeType)
  const candidates = getUploadCandidateNames(args.fileName)

  let storedName = candidates.first
  let absolutePath = path.join(uploadDir, storedName)
  let counter = 1

  while (true) {
    try {
      const handle = await open(absolutePath, "wx")
      try {
        await handle.writeFile(args.bytes)
      } finally {
        await handle.close()
      }
      break
    } catch (error) {
      const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined
      if (code !== "EEXIST") {
        throw error
      }

      storedName = candidates.withCounter(counter)
      absolutePath = path.join(uploadDir, storedName)
      counter += 1
    }
  }

  return createUploadAttachment({
    projectId: args.projectId,
    fileName: args.fileName,
    storedName,
    absolutePath,
    mimeType,
    size: args.bytes.byteLength,
  })
}

export async function persistRemoteProjectUpload(args: {
  projectId: string
  localPath: string
  fileName: string
  bytes: Uint8Array
  fallbackMimeType?: string
  host: RemoteHostConfig
}): Promise<ChatAttachment> {
  const mimeType = await getUploadMimeType(args.bytes, args.fallbackMimeType)
  const candidates = getUploadCandidateNames(args.fileName)
  const command = [
    `cd ${remotePathExpression(args.localPath)}`,
    `node -e ${shellQuote(getRemoteUploadScript(candidates))}`,
  ].join(" && ")
  const result = await runSshWithInput(args.host, command, Buffer.from(args.bytes).toString("base64"), 30_000)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Failed to upload file to ${args.host.label}`)
  }

  const payload = result.stdout.trim().split("\n").at(-1)
  if (!payload) {
    throw new Error(`Remote upload returned an empty response from ${args.host.label}`)
  }

  const parsed = JSON.parse(payload) as { storedName?: string; absolutePath?: string }
  if (!parsed.storedName || !parsed.absolutePath || !isValidStoredUploadName(parsed.storedName)) {
    throw new Error(`Remote upload returned an invalid response from ${args.host.label}`)
  }

  return createUploadAttachment({
    projectId: args.projectId,
    fileName: args.fileName,
    storedName: parsed.storedName,
    absolutePath: parsed.absolutePath,
    mimeType,
    size: args.bytes.byteLength,
  })
}

export function inferAttachmentContentType(fileName: string, fallbackType?: string): string {
  const extension = path.extname(fileName).toLowerCase()
  const mappedType = TEXT_CONTENT_TYPE_BY_EXTENSION.get(extension) ?? BINARY_CONTENT_TYPE_BY_EXTENSION.get(extension)
  if (mappedType) {
    return mappedType
  }

  if (TEXT_LIKE_EXTENSIONS.has(extension)) {
    return TEXT_PLAIN_CONTENT_TYPE
  }

  return fallbackType || DEFAULT_BINARY_MIME_TYPE
}

export function inferProjectFileContentType(fileName: string, fallbackType?: string): string {
  return inferAttachmentContentType(fileName, fallbackType)
}

export async function deleteProjectUpload(args: {
  localPath: string
  storedName: string
}): Promise<boolean> {
  const storedName = args.storedName
  if (!isValidStoredUploadName(storedName)) {
    return false
  }

  const absolutePath = path.join(getProjectUploadDir(args.localPath), storedName)
  try {
    await rm(absolutePath, { force: true })
    return true
  } catch {
    return false
  }
}

export async function readRemoteProjectUpload(args: {
  host: RemoteHostConfig
  localPath: string
  storedName: string
}): Promise<Uint8Array | null> {
  if (!isValidStoredUploadName(args.storedName)) {
    return null
  }

  const command = [
    `cd ${remotePathExpression(args.localPath)}`,
    `node -e ${shellQuote(getRemoteReadUploadScript(args.storedName))}`,
  ].join(" && ")
  const result = await runSsh(args.host, command, 30_000)
  if (result.exitCode === 3) {
    return null
  }
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Failed to read upload from ${args.host.label}`)
  }

  const payload = result.stdout.trim().split("\n").at(-1)
  if (!payload) {
    return null
  }
  const parsed = JSON.parse(payload) as { base64?: string }
  return typeof parsed.base64 === "string" ? Buffer.from(parsed.base64, "base64") : null
}

export async function deleteRemoteProjectUpload(args: {
  host: RemoteHostConfig
  localPath: string
  storedName: string
}): Promise<boolean> {
  if (!isValidStoredUploadName(args.storedName)) {
    return false
  }

  const command = [
    `cd ${remotePathExpression(args.localPath)}`,
    `node -e ${shellQuote(getRemoteDeleteUploadScript(args.storedName))}`,
  ].join(" && ")
  const result = await runSsh(args.host, command, 15_000)
  if (result.exitCode !== 0) {
    return false
  }

  const payload = result.stdout.trim().split("\n").at(-1)
  if (!payload) {
    return false
  }
  const parsed = JSON.parse(payload) as { ok?: boolean }
  return Boolean(parsed.ok)
}
