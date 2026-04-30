import type { CodexAssetsSnapshot, MachineId, RemoteHostConfig } from "../shared/types"
import { runSshWithInput } from "./remote-hosts"

const CODEX_ASSET_SCAN_TIMEOUT_MS = 15_000

function getCodexAssetsScanScript() {
  return String.raw`const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const home = os.homedir();
const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
const warnings = [];

function statSafe(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function readJson(filePath) {
  const text = readText(filePath);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    warnings.push("Invalid JSON: " + filePath);
    return null;
  }
}

function stripQuotes(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSkillFrontmatter(text) {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end === -1) return {};
  const frontmatter = text.slice(3, end).trim().split(/\r?\n/);
  const result = {};
  for (const line of frontmatter) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!match) continue;
    result[match[1]] = stripQuotes(match[2]);
  }
  return result;
}

function walkDirectories(root, maxDepth, visitor) {
  const rootInfo = statSafe(root);
  if (!rootInfo || !rootInfo.isDirectory()) return;

  function walk(currentPath, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === "." || entry.name === ".." || entry.name === ".git" || entry.name === "node_modules") continue;
      const entryPath = path.join(currentPath, entry.name);
      visitor(entryPath, entry, depth);
      if (entry.isDirectory()) {
        walk(entryPath, depth + 1);
      }
    }
  }

  walk(root, 0);
}

function countFiles(root, predicate, maxDepth = 3) {
  let count = 0;
  walkDirectories(root, maxDepth, (entryPath, entry) => {
    if (entry.isFile() && predicate(entryPath, entry.name)) count += 1;
  });
  return count;
}

function findSkillFiles(root) {
  const files = [];
  walkDirectories(root, 5, (entryPath, entry) => {
    if (entry.isFile() && entry.name === "SKILL.md") files.push(entryPath);
  });
  return files;
}

function scanSkills() {
  const skillsRoot = path.join(codexHome, "skills");
  const skills = [];
  for (const skillPath of findSkillFiles(skillsRoot)) {
    const text = readText(skillPath);
    if (!text) continue;
    const meta = parseSkillFrontmatter(text);
    const directory = path.dirname(skillPath);
    const relative = path.relative(skillsRoot, directory).replace(/\\/g, "/");
    const name = String(meta.name || path.basename(directory));
    const description = typeof meta.description === "string" && meta.description.trim()
      ? meta.description.trim()
      : undefined;
    const info = statSafe(skillPath);
    skills.push({
      name,
      description,
      path: directory,
      scope: relative.startsWith(".system/") || relative === ".system" ? "system" : "user",
      updatedAt: info ? info.mtimeMs : undefined,
    });
  }
  skills.sort((left, right) => {
    if (left.scope !== right.scope) return left.scope === "user" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
  return skills;
}

function pluginFromManifest(pluginPath, manifestPath, source, marketplacePath, marketplaceEntry) {
  const manifest = readJson(manifestPath);
  const info = statSafe(manifestPath);
  const iface = manifest && typeof manifest.interface === "object" && !Array.isArray(manifest.interface)
    ? manifest.interface
    : {};
  const policy = marketplaceEntry && typeof marketplaceEntry.policy === "object" && !Array.isArray(marketplaceEntry.policy)
    ? marketplaceEntry.policy
    : {};
  const name = String(manifest?.name || marketplaceEntry?.name || path.basename(pluginPath));
  const skillsPath = typeof manifest?.skills === "string" ? path.resolve(pluginPath, manifest.skills) : path.join(pluginPath, "skills");
  const commandsPath = path.join(pluginPath, "commands");
  return {
    name,
    displayName: typeof iface.displayName === "string" ? iface.displayName : undefined,
    description: typeof iface.shortDescription === "string"
      ? iface.shortDescription
      : typeof manifest?.description === "string"
        ? manifest.description
        : typeof iface.longDescription === "string"
          ? iface.longDescription
          : undefined,
    version: typeof manifest?.version === "string" ? manifest.version : undefined,
    path: pluginPath,
    manifestPath: statSafe(manifestPath) ? manifestPath : undefined,
    marketplacePath,
    source,
    installation: typeof policy.installation === "string" ? policy.installation : undefined,
    authentication: typeof policy.authentication === "string" ? policy.authentication : undefined,
    category: typeof marketplaceEntry?.category === "string"
      ? marketplaceEntry.category
      : typeof iface.category === "string"
        ? iface.category
        : undefined,
    skillCount: countFiles(skillsPath, (_entryPath, name) => name === "SKILL.md"),
    commandCount: countFiles(commandsPath, (entryPath) => entryPath.endsWith(".md")),
    updatedAt: info ? info.mtimeMs : undefined,
  };
}

function scanInstalledPlugins() {
  const pluginRoots = [
    path.join(home, "plugins"),
    path.join(home, ".agents", "plugins"),
    path.join(codexHome, "plugins"),
  ];
  const plugins = [];
  const seenManifests = new Set();
  for (const root of pluginRoots) {
    walkDirectories(root, 4, (entryPath, entry) => {
      if (!entry.isFile() || entry.name !== "plugin.json") return;
      if (path.basename(path.dirname(entryPath)) !== ".codex-plugin") return;
      const manifestPath = entryPath;
      if (seenManifests.has(manifestPath)) return;
      seenManifests.add(manifestPath);
      plugins.push(pluginFromManifest(path.dirname(path.dirname(manifestPath)), manifestPath, "installed"));
    });
  }
  return plugins;
}

function marketplaceRoot(marketplacePath) {
  return path.resolve(path.dirname(marketplacePath), "..", "..");
}

function scanMarketplacePlugins() {
  const marketplacePaths = [
    path.join(home, ".agents", "plugins", "marketplace.json"),
    path.join(codexHome, ".agents", "plugins", "marketplace.json"),
    path.join(codexHome, ".tmp", "plugins", ".agents", "plugins", "marketplace.json"),
  ];
  const plugins = [];
  for (const marketplacePath of marketplacePaths) {
    const marketplace = readJson(marketplacePath);
    if (!marketplace || !Array.isArray(marketplace.plugins)) continue;
    const root = marketplaceRoot(marketplacePath);
    for (const entry of marketplace.plugins) {
      if (!entry || typeof entry !== "object") continue;
      const source = entry.source && typeof entry.source === "object" && !Array.isArray(entry.source) ? entry.source : {};
      const sourcePath = typeof source.path === "string" ? source.path : "";
      const pluginPath = sourcePath
        ? path.resolve(root, sourcePath)
        : path.join(root, "plugins", String(entry.name || ""));
      const manifestPath = path.join(pluginPath, ".codex-plugin", "plugin.json");
      plugins.push(pluginFromManifest(pluginPath, manifestPath, "marketplace", marketplacePath, entry));
    }
  }
  return plugins;
}

function scanPlugins() {
  const byKey = new Map();
  for (const plugin of [...scanMarketplacePlugins(), ...scanInstalledPlugins()]) {
    const key = plugin.manifestPath || plugin.path || plugin.name;
    const existing = byKey.get(key);
    byKey.set(key, existing ? { ...existing, ...plugin, source: existing.source === "installed" ? "installed" : plugin.source } : plugin);
  }
  return [...byKey.values()].sort((left, right) => {
    if (left.source !== right.source) return left.source === "installed" ? -1 : 1;
    const leftName = left.displayName || left.name;
    const rightName = right.displayName || right.name;
    return leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
  });
}

console.log(JSON.stringify({
  scannedAt: Date.now(),
  skills: scanSkills(),
  plugins: scanPlugins(),
  warnings,
}));`
}

function normalizeScanPayload(machineId: MachineId, payload: unknown): CodexAssetsSnapshot {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Partial<CodexAssetsSnapshot>
    : {}
  return {
    machineId,
    scannedAt: typeof record.scannedAt === "number" ? record.scannedAt : Date.now(),
    skills: Array.isArray(record.skills) ? record.skills : [],
    plugins: Array.isArray(record.plugins) ? record.plugins : [],
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((entry): entry is string => typeof entry === "string") : undefined,
  }
}

function parseScanStdout(machineId: MachineId, stdout: string): CodexAssetsSnapshot {
  const payload = stdout.trim().split("\n").at(-1)
  if (!payload) {
    throw new Error("Codex asset scan returned an empty response")
  }
  return normalizeScanPayload(machineId, JSON.parse(payload))
}

export async function scanLocalCodexAssets(machineId: MachineId): Promise<CodexAssetsSnapshot> {
  const child = Bun.spawn([process.execPath, "-e", getCodexAssetsScanScript()], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const timeout = setTimeout(() => child.kill("SIGKILL"), CODEX_ASSET_SCAN_TIMEOUT_MS)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || "Failed to scan local Codex assets")
    }
    return parseScanStdout(machineId, stdout)
  } finally {
    clearTimeout(timeout)
  }
}

export async function scanRemoteCodexAssets(machineId: MachineId, host: RemoteHostConfig): Promise<CodexAssetsSnapshot> {
  const result = await runSshWithInput(host, "node", getCodexAssetsScanScript(), CODEX_ASSET_SCAN_TIMEOUT_MS)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Failed to scan Codex assets on ${host.label}`)
  }
  return parseScanStdout(machineId, result.stdout)
}
