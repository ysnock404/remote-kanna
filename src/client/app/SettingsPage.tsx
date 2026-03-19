import { useEffect, useState, type KeyboardEvent } from "react"
import { Info, Loader2, RotateCcw, Settings } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import { SDK_CLIENT_APP } from "../../shared/branding"
import { Button } from "../components/ui/button"
import {
  DEFAULT_EDITOR_PRESET,
  DEFAULT_TERMINAL_SCROLLBACK,
  DEFAULT_TERMINAL_MIN_COLUMN_WIDTH,
  MAX_TERMINAL_MIN_COLUMN_WIDTH,
  MAX_TERMINAL_SCROLLBACK,
  MIN_TERMINAL_MIN_COLUMN_WIDTH,
  MIN_TERMINAL_SCROLLBACK,
  getDefaultEditorCommandTemplate,
  getEditorPresetLabel,
  useTerminalPreferencesStore,
} from "../stores/terminalPreferencesStore"
import { PageHeader } from "./PageHeader"
import type { KannaState } from "./useKannaState"

function SettingsCard({
  title,
  description,
  value,
}: {
  title: string
  description: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-1 text-sm font-medium text-foreground">{title}</div>
      <div className="mb-3 text-sm text-muted-foreground">{description}</div>
      <div className="rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm text-foreground">
        {value}
      </div>
    </div>
  )
}

export function SettingsPage() {
  const state = useOutletContext<KannaState>()
  const isConnecting = state.connectionStatus === "connecting" || !state.localProjectsReady
  const machineName = state.localProjects?.machine.displayName ?? "Settings"
  const scrollbackLines = useTerminalPreferencesStore((store) => store.scrollbackLines)
  const minColumnWidth = useTerminalPreferencesStore((store) => store.minColumnWidth)
  const editorPreset = useTerminalPreferencesStore((store) => store.editorPreset)
  const editorCommandTemplate = useTerminalPreferencesStore((store) => store.editorCommandTemplate)
  const setScrollbackLines = useTerminalPreferencesStore((store) => store.setScrollbackLines)
  const setMinColumnWidth = useTerminalPreferencesStore((store) => store.setMinColumnWidth)
  const setEditorPreset = useTerminalPreferencesStore((store) => store.setEditorPreset)
  const setEditorCommandTemplate = useTerminalPreferencesStore((store) => store.setEditorCommandTemplate)
  const [scrollbackDraft, setScrollbackDraft] = useState(String(scrollbackLines))
  const [minColumnWidthDraft, setMinColumnWidthDraft] = useState(String(minColumnWidth))
  const [editorCommandDraft, setEditorCommandDraft] = useState(editorCommandTemplate)

  useEffect(() => {
    setScrollbackDraft(String(scrollbackLines))
  }, [scrollbackLines])

  useEffect(() => {
    setMinColumnWidthDraft(String(minColumnWidth))
  }, [minColumnWidth])

  useEffect(() => {
    setEditorCommandDraft(editorCommandTemplate)
  }, [editorCommandTemplate])

  function commitScrollback() {
    const nextValue = Number(scrollbackDraft)
    if (!Number.isFinite(nextValue)) {
      setScrollbackDraft(String(scrollbackLines))
      return
    }
    setScrollbackLines(nextValue)
  }

  function commitMinColumnWidth() {
    const nextValue = Number(minColumnWidthDraft)
    if (!Number.isFinite(nextValue)) {
      setMinColumnWidthDraft(String(minColumnWidth))
      return
    }
    setMinColumnWidth(nextValue)
  }

  function handleNumberInputKeyDown(event: KeyboardEvent<HTMLInputElement>, commit: () => void) {
    if (event.key !== "Enter") return
    commit()
    event.currentTarget.blur()
  }

  function commitEditorCommand() {
    setEditorCommandTemplate(editorCommandDraft)
  }

  const editorExamples = {
    project: editorPreset === "custom"
      ? editorCommandDraft
      : `${getEditorPresetLabel(editorPreset)}: ${getDefaultEditorCommandTemplate(editorPreset)}`,
    file: editorPreset === "custom"
      ? editorCommandDraft.replaceAll("{path}", "/Users/jake/Projects/kanna/src/client/app/App.tsx").replaceAll("{line}", "12").replaceAll("{column}", "1")
      : `${editorCommandTemplate}  |  line links use the editor's built-in goto form`,
  }

  return (
    <div className="flex-1 min-w-0 overflow-y-auto bg-background">
      <PageHeader
        icon={Settings}
        title={"Settings"}
      />

      <div className="w-full px-6 pb-10">


        {isConnecting ? (
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading machine settings…</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SettingsCard
              title="Machine"
              description="The local machine currently connected to Kanna."
              value={state.localProjects?.machine.displayName ?? "Unavailable"}
            />
            <SettingsCard
              title="Connection"
              description="Current connection state for the local Kanna runtime."
              value={state.connectionStatus}
            />
            <SettingsCard
              title="Projects Indexed"
              description="Number of local projects currently available in the app."
              value={String(state.localProjects?.projects.length ?? 0)}
            />
            <SettingsCard
              title="App Version"
              description="Current Kanna desktop client build."
              value={SDK_CLIENT_APP.split("/")[1] ?? "unknown"}
            />
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="mb-1 text-sm font-medium text-foreground">Terminal Scrollback</div>
                  <div className="text-sm text-muted-foreground">
                    Number of lines retained for embedded terminal history.
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setScrollbackLines(DEFAULT_TERMINAL_SCROLLBACK)}
                >
                  <RotateCcw className="size-3.5" />
                  Restore Default
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={MIN_TERMINAL_SCROLLBACK}
                  max={MAX_TERMINAL_SCROLLBACK}
                  step={100}
                  value={scrollbackDraft}
                  onChange={(event) => setScrollbackDraft(event.target.value)}
                  onBlur={commitScrollback}
                  onKeyDown={(event) => handleNumberInputKeyDown(event, commitScrollback)}
                  className="w-32 rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none ring-0"
                />
                <div className="text-xs text-muted-foreground">
                  {MIN_TERMINAL_SCROLLBACK}-{MAX_TERMINAL_SCROLLBACK} lines
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="mb-1 text-sm font-medium text-foreground">Terminal Min Column Width</div>
                  <div className="text-sm text-muted-foreground">
                    Minimum width for each embedded terminal pane before resize is constrained.
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMinColumnWidth(DEFAULT_TERMINAL_MIN_COLUMN_WIDTH)}
                >
                  <RotateCcw className="size-3.5" />
                  Restore Default
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={MIN_TERMINAL_MIN_COLUMN_WIDTH}
                  max={MAX_TERMINAL_MIN_COLUMN_WIDTH}
                  step={10}
                  value={minColumnWidthDraft}
                  onChange={(event) => setMinColumnWidthDraft(event.target.value)}
                  onBlur={commitMinColumnWidth}
                  onKeyDown={(event) => handleNumberInputKeyDown(event, commitMinColumnWidth)}
                  className="w-32 rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none ring-0"
                />
                <div className="text-xs text-muted-foreground">
                  {MIN_TERMINAL_MIN_COLUMN_WIDTH}-{MAX_TERMINAL_MIN_COLUMN_WIDTH} px
                  {minColumnWidth === DEFAULT_TERMINAL_MIN_COLUMN_WIDTH ? " default" : ""}
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 lg:col-span-2">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="mb-1 text-sm font-medium text-foreground">Default Editor</div>
                  <div className="text-sm text-muted-foreground">
                    Used by the navbar code button and local file links in chat.
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditorPreset(DEFAULT_EDITOR_PRESET)}
                >
                  <RotateCcw className="size-3.5" />
                  Restore Default
                </Button>
              </div>
              <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
                <label className="flex flex-col gap-2 text-sm text-foreground">
                  <span>Editor</span>
                  <select
                    value={editorPreset}
                    onChange={(event) => setEditorPreset(event.target.value as typeof editorPreset)}
                    className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-0"
                  >
                    <option value="cursor">Cursor</option>
                    <option value="vscode">VS Code</option>
                    <option value="windsurf">Windsurf</option>
                    <option value="custom">Custom command</option>
                  </select>
                </label>
                <label className="flex flex-col gap-2 text-sm text-foreground">
                  <span>Command Template</span>
                  <input
                    type="text"
                    value={editorCommandDraft}
                    onChange={(event) => setEditorCommandDraft(event.target.value)}
                    onBlur={commitEditorCommand}
                    onKeyDown={(event) => handleNumberInputKeyDown(event as unknown as KeyboardEvent<HTMLInputElement>, commitEditorCommand)}
                    disabled={editorPreset !== "custom"}
                    className="rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm text-foreground outline-none ring-0 disabled:opacity-70"
                  />
                  <div className="text-xs text-muted-foreground">
                    Custom templates must include <code>{"{path}"}</code>. Supported placeholders: <code>{"{path}"}</code>, <code>{"{line}"}</code>, <code>{"{column}"}</code>.
                  </div>
                </label>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <SettingsCard
                  title="Project Open Preview"
                  description="Used by the navbar code button for the current project."
                  value={editorExamples.project}
                />
                <SettingsCard
                  title="File Link Preview"
                  description="Used when clicking a local file link in chat."
                  value={editorExamples.file}
                />
              </div>
            </div>
          </div>
        )}

        {state.commandError ? (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{state.commandError}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
