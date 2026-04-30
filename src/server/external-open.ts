import { stat } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import type { ClientCommand, EditorOpenSettings, EditorPreset } from "../shared/protocol"
import type { RemoteHostConfig } from "../shared/types"
import { resolveLocalPath } from "./paths"
import { canOpenMacApp, hasCommand, spawnDetached } from "./process-utils"
import { remotePathExpression, runSsh, shellQuote } from "./remote-hosts"

type OpenExternalCommand = Extract<ClientCommand, { type: "system.openExternal" }>

interface CommandSpec {
  command: string
  args: string[]
}

const DEFAULT_EDITOR_SETTINGS: EditorOpenSettings = {
  preset: "cursor",
  commandTemplate: "cursor {path}",
}

function getLinuxDesktopOpener(): CommandSpec | null {
  if (hasCommand("xdg-open")) return { command: "xdg-open", args: [] }
  if (hasCommand("gio")) return { command: "gio", args: ["open"] }
  return null
}

function missingDesktopOpenerMessage() {
  return "No desktop opener is available on this machine. Install xdg-utils/gio, or use Open in Cursor/Finder from a project that belongs to a remote desktop machine."
}

export async function openExternal(command: OpenExternalCommand) {
  const resolvedPath = resolveLocalPath(command.localPath)
  const platform = process.platform
  const info = command.action === "open_editor" || command.action === "open_finder" || command.action === "open_preview" || command.action === "open_default"
    ? await stat(resolvedPath).catch(() => null)
    : null

  if (command.action === "open_editor") {
    if (!info) {
      throw new Error(`Path not found: ${resolvedPath}`)
    }
    const editorCommand = buildEditorCommand({
      localPath: resolvedPath,
      isDirectory: info.isDirectory(),
      line: command.line,
      column: command.column,
      editor: command.editor ?? DEFAULT_EDITOR_SETTINGS,
      platform,
    })
    await spawnDetached(editorCommand.command, editorCommand.args)
    return
  }

  if (platform === "darwin") {
    if (command.action === "open_default") {
      if (!info) {
        throw new Error(`Path not found: ${resolvedPath}`)
      }
      const defaultCommand = buildDefaultOpenCommand({ localPath: resolvedPath, platform })
      await spawnDetached(defaultCommand.command, defaultCommand.args)
      return
    }
    if (command.action === "open_preview") {
      if (!info) {
        throw new Error(`Path not found: ${resolvedPath}`)
      }
      if (!canOpenMacApp("Preview")) {
        throw new Error("Preview is not installed")
      }
      const previewCommand = buildPreviewCommand({
        localPath: resolvedPath,
        isDirectory: info.isDirectory(),
        platform,
      })
      await spawnDetached(previewCommand.command, previewCommand.args)
      return
    }
    if (command.action === "open_finder") {
      if (info?.isDirectory()) {
        await spawnDetached("open", [resolvedPath])
      } else {
        await spawnDetached("open", ["-R", resolvedPath])
      }
      return
    }
    if (command.action === "open_terminal") {
      if (!canOpenMacApp("Terminal")) {
        throw new Error("Terminal is not installed")
      }
      await spawnDetached("open", ["-a", "Terminal", resolvedPath])
      return
    }
  }

  if (platform === "win32") {
    if (command.action === "open_default") {
      if (!info) {
        throw new Error(`Path not found: ${resolvedPath}`)
      }
      const defaultCommand = buildDefaultOpenCommand({ localPath: resolvedPath, platform })
      await spawnDetached(defaultCommand.command, defaultCommand.args)
      return
    }
    if (command.action === "open_finder") {
      if (info?.isDirectory()) {
        await spawnDetached("explorer", [resolvedPath])
      } else {
        await spawnDetached("explorer", ["/select,", resolvedPath])
      }
      return
    }
    if (command.action === "open_terminal") {
      if (hasCommand("wt")) {
        await spawnDetached("wt", ["-d", resolvedPath])
        return
      }
      await spawnDetached("cmd", ["/c", "start", "", "cmd", "/K", `cd /d ${resolvedPath}`])
      return
    }
  }

  if (command.action === "open_preview") {
    throw new Error("Preview is only available on macOS")
  }

  if (command.action === "open_default") {
    if (!info) {
      throw new Error(`Path not found: ${resolvedPath}`)
    }
    if (platform === "linux") {
      const opener = getLinuxDesktopOpener()
      if (!opener) throw new Error(missingDesktopOpenerMessage())
      await spawnDetached(opener.command, [...opener.args, resolvedPath])
      return
    }
    const defaultCommand = buildDefaultOpenCommand({ localPath: resolvedPath, platform })
    await spawnDetached(defaultCommand.command, defaultCommand.args)
    return
  }

  if (command.action === "open_finder") {
    const opener = getLinuxDesktopOpener()
    if (!opener) throw new Error(missingDesktopOpenerMessage())
    await spawnDetached(opener.command, [...opener.args, info?.isDirectory() ? resolvedPath : path.dirname(resolvedPath)])
    return
  }
  if (command.action === "open_terminal") {
    for (const terminalCommand of ["x-terminal-emulator", "gnome-terminal", "konsole"]) {
      if (!hasCommand(terminalCommand)) continue
      if (terminalCommand === "gnome-terminal") {
        await spawnDetached(terminalCommand, ["--working-directory", resolvedPath])
      } else if (terminalCommand === "konsole") {
        await spawnDetached(terminalCommand, ["--workdir", resolvedPath])
      } else {
        await spawnDetached(terminalCommand, ["--working-directory", resolvedPath])
      }
      return
    }
    const opener = getLinuxDesktopOpener()
    if (!opener) throw new Error(missingDesktopOpenerMessage())
    await spawnDetached(opener.command, [...opener.args, resolvedPath])
  }
}

export async function openExternalOnRemote(host: RemoteHostConfig, command: OpenExternalCommand) {
  const remoteCommand = buildRemoteExternalCommand(command)
  console.log(`[kanna] open external remote ${host.label}: ${command.action} ${command.localPath}`)
  const result = await runSsh(host, remoteCommand, 10_000)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `Failed to open path on ${host.label}`)
  }
}

export function buildRemoteExternalCommand(command: OpenExternalCommand) {
  const editor = normalizeEditorSettings(command.editor ?? DEFAULT_EDITOR_SETTINGS)
  const customEditorCommand = editor.preset === "custom"
    ? buildCustomEditorCommand({
        commandTemplate: editor.commandTemplate,
        localPath: command.localPath,
        line: command.line,
        column: command.column,
      })
    : null
  const customEditorCommandLine = customEditorCommand
    ? [customEditorCommand.command, ...customEditorCommand.args].map(shellQuote).join(" ")
    : ""

  const preset = editor.preset
  const action = command.action
  const line = command.line ? String(command.line) : ""
  const column = command.column ? String(command.column) : "1"

  const invokeAction = (() => {
    switch (action) {
      case "open_editor":
        if (preset === "custom") {
          return `kanna_open_custom_editor`
        }
        return `kanna_open_editor_preset ${shellQuote(preset)}`
      case "open_finder":
        return "kanna_open_finder"
      case "open_terminal":
        return "kanna_open_terminal"
      case "open_preview":
        return "kanna_open_preview"
      case "open_default":
      default:
        return "kanna_open_default \"$target\""
    }
  })()

  return [
    `target=${remotePathExpression(command.localPath)}`,
    `[ -e "$target" ] || { echo "Path not found: $target" >&2; exit 2; }`,
    `is_dir=0`,
    `[ -d "$target" ] && is_dir=1`,
    `parent=$(dirname "$target")`,
    `open_dir="$target"`,
    `[ "$is_dir" = "1" ] || open_dir="$parent"`,
    `platform=$(uname -s 2>/dev/null || echo unknown)`,
    `line=${shellQuote(line)}`,
    `column=${shellQuote(column)}`,
    `custom_editor_command=${shellQuote(customEditorCommandLine)}`,
    `kanna_detach() { "$@" >/dev/null 2>&1 & }`,
    `kanna_win_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }`,
    `kanna_win_editor_exe() {`,
    `  case "$1" in`,
    `    cursor) candidates="$LOCALAPPDATA/Programs/cursor/Cursor.exe|$LOCALAPPDATA/Programs/Cursor/Cursor.exe|$USERPROFILE/AppData/Local/Programs/cursor/Cursor.exe|$USERPROFILE/AppData/Local/Programs/Cursor/Cursor.exe" ;;`,
    `    vscode) candidates="$LOCALAPPDATA/Programs/Microsoft VS Code/Code.exe|$USERPROFILE/AppData/Local/Programs/Microsoft VS Code/Code.exe" ;;`,
    `    windsurf) candidates="$LOCALAPPDATA/Programs/Windsurf/Windsurf.exe|$USERPROFILE/AppData/Local/Programs/Windsurf/Windsurf.exe" ;;`,
    `    *) return 1 ;;`,
    `  esac`,
    `  old_ifs=$IFS; IFS='|'`,
    `  for exe in $candidates; do [ -f "$exe" ] && { printf '%s' "$exe"; IFS="$old_ifs"; return 0; }; done`,
    `  IFS="$old_ifs"; return 1`,
    `}`,
    `kanna_open_with_desktop() {`,
    `  case "$platform" in`,
    `    Darwin*) kanna_detach open "$1" ;;`,
    `    MINGW*|MSYS*|CYGWIN*) win_path=$(kanna_win_path "$1"); cmd.exe //c start "" "$win_path" >/dev/null 2>&1 & ;;`,
    `    *)`,
    `      if command -v xdg-open >/dev/null 2>&1; then kanna_detach xdg-open "$1";`,
    `      elif command -v gio >/dev/null 2>&1; then kanna_detach gio open "$1";`,
    `      else echo "No desktop opener found on remote host" >&2; exit 127; fi`,
    `      ;;`,
    `  esac`,
    `}`,
    `kanna_open_finder() {`,
    `  case "$platform" in`,
    `    Darwin*) if [ "$is_dir" = "1" ]; then kanna_detach open "$target"; else kanna_detach open -R "$target"; fi ;;`,
    `    MINGW*|MSYS*|CYGWIN*)`,
    `      win_path=$(kanna_win_path "$target")`,
    `      if [ "$is_dir" = "1" ]; then`,
    `        cmd.exe //c start "" "$win_path" >/dev/null 2>&1 &`,
    `      else`,
    `        explorer.exe /select,"$win_path" >/dev/null 2>&1 &`,
    `      fi`,
    `      ;;`,
    `    *) kanna_open_with_desktop "$open_dir" ;;`,
    `  esac`,
    `}`,
    `kanna_open_terminal() {`,
    `  case "$platform" in`,
    `    Darwin*) kanna_detach open -a Terminal "$open_dir" ;;`,
    `    MINGW*|MSYS*|CYGWIN*) win_dir=$(kanna_win_path "$open_dir"); if command -v wt.exe >/dev/null 2>&1; then kanna_detach wt.exe -d "$win_dir"; else cmd.exe //c start "" cmd //K "cd /d $win_dir" >/dev/null 2>&1 & fi ;;`,
    `    *)`,
    `      if command -v x-terminal-emulator >/dev/null 2>&1; then kanna_detach x-terminal-emulator --working-directory "$open_dir";`,
    `      elif command -v gnome-terminal >/dev/null 2>&1; then kanna_detach gnome-terminal --working-directory "$open_dir";`,
    `      elif command -v konsole >/dev/null 2>&1; then kanna_detach konsole --workdir "$open_dir";`,
    `      else kanna_open_with_desktop "$open_dir"; fi`,
    `      ;;`,
    `  esac`,
    `}`,
    `kanna_open_preview() {`,
    `  [ "$is_dir" = "0" ] || { echo "Preview cannot open directories" >&2; exit 2; }`,
    `  case "$platform" in`,
    `    Darwin*) kanna_detach open -a Preview "$target" ;;`,
    `    *) echo "Preview is only available on macOS" >&2; exit 2 ;;`,
    `  esac`,
    `}`,
    `kanna_open_custom_editor() {`,
    `  [ -n "$custom_editor_command" ] || { echo "Custom editor command is empty" >&2; exit 2; }`,
    `  nohup sh -lc "$custom_editor_command" >/dev/null 2>&1 &`,
    `}`,
    `kanna_open_editor_preset() {`,
    `  preset="$1"`,
    `  cli="$preset"`,
    `  mac_app="$preset"`,
    `  case "$preset" in`,
    `    cursor) cli="cursor"; mac_app="Cursor" ;;`,
    `    vscode) cli="code"; mac_app="Visual Studio Code" ;;`,
    `    windsurf) cli="windsurf"; mac_app="Windsurf" ;;`,
    `    xcode) cli="xed"; mac_app="Xcode" ;;`,
    `  esac`,
    `  if command -v "$cli" >/dev/null 2>&1; then`,
    `    if [ "$preset" = "xcode" ] && [ "$is_dir" = "0" ] && [ -n "$line" ]; then kanna_detach "$cli" -l "$line" "$target"; return; fi`,
    `    if [ "$is_dir" = "0" ] && [ -n "$line" ] && [ "$preset" != "xcode" ]; then kanna_detach "$cli" --goto "$target:$line:$column"; return; fi`,
    `    kanna_detach "$cli" "$target"; return`,
    `  fi`,
    `  case "$platform" in`,
    `    Darwin*) kanna_detach open -a "$mac_app" "$target" ;;`,
    `    MINGW*|MSYS*|CYGWIN*)`,
    `      win_path=$(kanna_win_path "$target")`,
    `      if win_exe=$(kanna_win_editor_exe "$preset"); then`,
    `        win_exe=$(kanna_win_path "$win_exe")`,
    `        if [ "$is_dir" = "0" ] && [ -n "$line" ] && [ "$preset" != "xcode" ]; then`,
    `          cmd.exe //c start "" "$win_exe" --goto "$win_path:$line:$column" >/dev/null 2>&1 &`,
    `        else`,
    `          cmd.exe //c start "" "$win_exe" "$win_path" >/dev/null 2>&1 &`,
    `        fi`,
    `      else`,
    `        cmd.exe //c start "" "$cli" "$win_path" >/dev/null 2>&1 &`,
    `      fi`,
    `      ;;`,
    `    *) echo "$mac_app is not installed on remote host" >&2; exit 127 ;;`,
    `  esac`,
    `}`,
    invokeAction,
  ].join("\n")
}

export function buildEditorCommand(args: {
  localPath: string
  isDirectory: boolean
  line?: number
  column?: number
  editor: EditorOpenSettings
  platform: NodeJS.Platform
}): CommandSpec {
  const editor = normalizeEditorSettings(args.editor)
  if (editor.preset === "custom") {
    return buildCustomEditorCommand({
      commandTemplate: editor.commandTemplate,
      localPath: args.localPath,
      line: args.line,
      column: args.column,
    })
  }
  return buildPresetEditorCommand(args, editor.preset)
}

export function buildPreviewCommand(args: {
  localPath: string
  isDirectory: boolean
  platform: NodeJS.Platform
}): CommandSpec {
  if (args.platform !== "darwin") {
    throw new Error("Preview is only available on macOS")
  }
  if (args.isDirectory) {
    throw new Error("Preview cannot open directories")
  }
  return { command: "open", args: ["-a", "Preview", args.localPath] }
}

export function buildDefaultOpenCommand(args: {
  localPath: string
  platform: NodeJS.Platform
}): CommandSpec {
  if (args.platform === "darwin") {
    return { command: "open", args: [args.localPath] }
  }
  if (args.platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", args.localPath] }
  }
  return { command: "xdg-open", args: [args.localPath] }
}

function buildPresetEditorCommand(
  args: {
    localPath: string
    isDirectory: boolean
    line?: number
    column?: number
    platform: NodeJS.Platform
  },
  preset: Exclude<EditorPreset, "custom">
): CommandSpec {
  const gotoTarget = `${args.localPath}:${args.line ?? 1}:${args.column ?? 1}`
  const opener = resolveEditorExecutable(preset, args.platform)
  if (preset === "xcode") {
    if (args.isDirectory || !args.line) {
      return { command: opener.command, args: [...opener.args, args.localPath] }
    }
    if (opener.command !== "xed") {
      return { command: opener.command, args: [...opener.args, args.localPath] }
    }
    return { command: opener.command, args: [...opener.args, "-l", String(args.line), args.localPath] }
  }
  if (args.isDirectory || !args.line) {
    return { command: opener.command, args: [...opener.args, args.localPath] }
  }
  return { command: opener.command, args: [...opener.args, "--goto", gotoTarget] }
}

function resolveEditorExecutable(preset: Exclude<EditorPreset, "custom">, platform: NodeJS.Platform) {
  if (preset === "cursor") {
    if (hasCommand("cursor")) return { command: "cursor", args: [] }
    if (platform === "darwin" && canOpenMacApp("Cursor")) return { command: "open", args: ["-a", "Cursor"] }
  }
  if (preset === "vscode") {
    if (hasCommand("code")) return { command: "code", args: [] }
    if (platform === "darwin" && canOpenMacApp("Visual Studio Code")) return { command: "open", args: ["-a", "Visual Studio Code"] }
  }
  if (preset === "windsurf") {
    if (hasCommand("windsurf")) return { command: "windsurf", args: [] }
    if (platform === "darwin" && canOpenMacApp("Windsurf")) return { command: "open", args: ["-a", "Windsurf"] }
  }
  if (preset === "xcode") {
    if (hasCommand("xed")) return { command: "xed", args: [] }
    if (platform === "darwin" && canOpenMacApp("Xcode")) return { command: "open", args: ["-a", "Xcode"] }
  }

  if (platform === "darwin") {
    switch (preset) {
      case "cursor":
        throw new Error("Cursor is not installed")
      case "vscode":
        throw new Error("Visual Studio Code is not installed")
      case "windsurf":
        throw new Error("Windsurf is not installed")
      case "xcode":
        throw new Error("Xcode is not installed")
    }
  }

  return { command: preset === "vscode" ? "code" : preset === "xcode" ? "xed" : preset, args: [] }
}

function buildCustomEditorCommand(args: {
  commandTemplate: string
  localPath: string
  line?: number
  column?: number
}): CommandSpec {
  const template = args.commandTemplate.trim()
  if (!template.includes("{path}")) {
    throw new Error("Custom editor command must include {path}")
  }

  const line = String(args.line ?? 1)
  const column = String(args.column ?? 1)
  const replaced = template
    .replaceAll("{path}", args.localPath)
    .replaceAll("{line}", line)
    .replaceAll("{column}", column)

  const tokens = tokenizeCommandTemplate(replaced)
  const [command, ...commandArgs] = tokens
  if (!command) {
    throw new Error("Custom editor command is empty")
  }
  return { command, args: commandArgs }
}

export function tokenizeCommandTemplate(template: string) {
  const tokens: string[] = []
  let current = ""
  let quote: "'" | "\"" | null = null

  for (let index = 0; index < template.length; index += 1) {
    const char = template[index]

    if (char === "\\" && index + 1 < template.length) {
      current += template[index + 1]
      index += 1
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === "'" || char === "\"") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ""
      }
      continue
    }

    current += char
  }

  if (quote) {
    throw new Error("Custom editor command has an unclosed quote")
  }
  if (current.length > 0) {
    tokens.push(current)
  }
  return tokens
}

function normalizeEditorSettings(editor: EditorOpenSettings): EditorOpenSettings {
  const preset = normalizeEditorPreset(editor.preset)
  return {
    preset,
    commandTemplate: editor.commandTemplate.trim() || DEFAULT_EDITOR_SETTINGS.commandTemplate,
  }
}

function normalizeEditorPreset(preset: EditorPreset): EditorPreset {
  switch (preset) {
    case "vscode":
    case "xcode":
    case "windsurf":
    case "custom":
    case "cursor":
      return preset
    default:
      return DEFAULT_EDITOR_SETTINGS.preset
  }
}
