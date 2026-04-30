import { useState, useEffect, useRef } from "react"
import { ChevronLeft, Folder, GitBranch, Loader2, RefreshCcw } from "lucide-react"
import { DEFAULT_NEW_PROJECT_ROOT } from "../../shared/branding"
import type { DirectoryBrowserSnapshot, MachineId } from "../../shared/types"
import { Button } from "./ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogBody,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog"
import { Input } from "./ui/input"
import { SegmentedControl } from "./ui/segmented-control"

interface Props {
  open: boolean
  machineId: MachineId
  machineLabel: string
  onBrowseDirectories?: (machineId: MachineId, path?: string) => Promise<DirectoryBrowserSnapshot>
  onOpenChange: (open: boolean) => void
  onConfirm: (project: { mode: Tab; machineId?: MachineId; localPath: string; title: string }) => void
}

type Tab = "new" | "existing"

function toKebab(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function NewProjectModal({
  open,
  machineId,
  machineLabel,
  onBrowseDirectories,
  onOpenChange,
  onConfirm,
}: Props) {
  const [tab, setTab] = useState<Tab>("new")
  const [name, setName] = useState("")
  const [existingPath, setExistingPath] = useState("")
  const [browserSnapshot, setBrowserSnapshot] = useState<DirectoryBrowserSnapshot | null>(null)
  const [browserLoading, setBrowserLoading] = useState(false)
  const [browserError, setBrowserError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const existingInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTab("new")
      setName("")
      setExistingPath("")
      setBrowserSnapshot(null)
      setBrowserError(null)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        if (tab === "new") inputRef.current?.focus()
        else existingInputRef.current?.focus()
      }, 0)
    }
  }, [tab, open])

  const kebab = toKebab(name)
  const newPath = kebab ? `${DEFAULT_NEW_PROJECT_ROOT}/${kebab}` : ""
  const trimmedExisting = existingPath.trim()

  const canSubmit = tab === "new" ? !!kebab : !!trimmedExisting

  async function loadDirectories(path?: string) {
    if (!onBrowseDirectories) return
    setBrowserLoading(true)
    setBrowserError(null)
    try {
      const snapshot = await onBrowseDirectories(machineId, path)
      setBrowserSnapshot(snapshot)
      setExistingPath(snapshot.path)
    } catch (error) {
      setBrowserError(error instanceof Error ? error.message : String(error))
    } finally {
      setBrowserLoading(false)
    }
  }

  useEffect(() => {
    if (!open || tab !== "existing" || !onBrowseDirectories) return
    void loadDirectories(existingPath.trim() || undefined)
    // The current text path is intentionally only used when opening/switching machines.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId, open, tab, onBrowseDirectories])

  const handleSubmit = () => {
    if (!canSubmit) return
    if (tab === "new") {
      onConfirm({ mode: "new", machineId, localPath: newPath, title: name.trim() })
    } else {
      const folderName = trimmedExisting.split("/").pop() || trimmedExisting
      onConfirm({ mode: "existing", machineId, localPath: trimmedExisting, title: folderName })
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogBody className="space-y-4">
          <DialogTitle>Add Project</DialogTitle>
          <DialogDescription>
            Create a project folder or open an existing path on {machineLabel}.
          </DialogDescription>

          <SegmentedControl
            value={tab}
            onValueChange={setTab}
            options={[
              { value: "new" as Tab, label: "New Folder" },
              { value: "existing" as Tab, label: "Existing Path" },
            ]}
            className="w-full mb-2"
            optionClassName="flex-1 justify-center"
          />

          {tab === "new" ? (
            <div className="space-y-2">
              <Input
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit()
                  if (e.key === "Escape") onOpenChange(false)
                }}
                placeholder="Project name"
              />
              {newPath && (
                <p className="text-xs text-muted-foreground font-mono">
                  {newPath}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                ref={existingInputRef}
                type="text"
                value={existingPath}
                onChange={(e) => setExistingPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (onBrowseDirectories) void loadDirectories(existingPath)
                    else handleSubmit()
                  }
                  if (e.key === "Escape") onOpenChange(false)
                }}
                placeholder="~/Projects/my-app"
              />
              {onBrowseDirectories ? (
                <div className="rounded-lg border border-border bg-card">
                  <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-2">
                    <div className="min-w-0 text-xs text-muted-foreground">
                      <span className="mr-1 text-foreground">{machineLabel}</span>
                      <span className="font-mono">{browserSnapshot?.path ?? (existingPath || "~")}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={browserLoading || !browserSnapshot?.parentPath}
                        onClick={() => void loadDirectories(browserSnapshot?.parentPath ?? undefined)}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={browserLoading}
                        onClick={() => void loadDirectories(existingPath || browserSnapshot?.path)}
                      >
                        {browserLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto p-1">
                    {browserError ? (
                      <div className="px-3 py-2 text-sm text-destructive">{browserError}</div>
                    ) : null}
                    {!browserError && browserLoading && !browserSnapshot ? (
                      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading folders
                      </div>
                    ) : null}
                    {!browserError && browserSnapshot?.entries.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No folders in this path.</div>
                    ) : null}
                    {browserSnapshot?.entries.map((entry) => (
                      <div key={entry.path} className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                        <button
                          type="button"
                          className="flex min-w-0 items-center gap-2 text-left"
                          onClick={() => void loadDirectories(entry.path)}
                        >
                          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 truncate text-sm text-foreground">{entry.name}</span>
                          {entry.isGitRepository ? <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          onClick={() => setExistingPath(entry.path)}
                        >
                          Select
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Choose a folder on {machineLabel}. The folder will be created if it doesn't exist.
              </p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {tab === "new" ? "Create Project" : "Open Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
