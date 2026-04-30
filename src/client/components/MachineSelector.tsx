import { useEffect, useMemo, useState } from "react"
import { Check, Laptop, Monitor, Pencil, X } from "lucide-react"
import { LOCAL_MACHINE_ID } from "../../shared/project-location"
import type { MachineId, MachineSummary } from "../../shared/types"
import { cn } from "../lib/utils"
import { Button } from "./ui/button"
import { Dialog, DialogBody, DialogContent, DialogTitle } from "./ui/dialog"
import { Input } from "./ui/input"

interface MachineSelectorProps {
  machines: MachineSummary[]
  selectedMachineId: MachineId
  projectCounts: Map<MachineId, number>
  onSelectMachine: (machineId: MachineId) => void
  onRenameMachine: (machineId: MachineId, label: string) => Promise<void>
  className?: string
  buttonClassName?: string
  compact?: boolean
}

function getMachineIcon(machine: MachineSummary) {
  const label = machine.displayName.toLowerCase()
  if (label.includes("macbook") || label.includes("laptop") || label.includes("portatil") || label.includes("portátil")) {
    return Laptop
  }
  return Monitor
}

function getFallbackLabel(machine: MachineSummary) {
  if (machine.id === LOCAL_MACHINE_ID) return "This machine"
  return machine.sshTarget ?? machine.id
}

export function MachineSelector({
  machines,
  selectedMachineId,
  projectCounts,
  onSelectMachine,
  onRenameMachine,
  className,
  buttonClassName,
  compact = false,
}: MachineSelectorProps) {
  const [open, setOpen] = useState(false)
  const [editingMachineId, setEditingMachineId] = useState<MachineId | null>(null)
  const [draftLabel, setDraftLabel] = useState("")
  const [savingMachineId, setSavingMachineId] = useState<MachineId | null>(null)
  const selectedMachine = useMemo(
    () => machines.find((machine) => machine.id === selectedMachineId) ?? machines[0] ?? null,
    [machines, selectedMachineId]
  )

  useEffect(() => {
    if (!open) {
      setEditingMachineId(null)
      setDraftLabel("")
    }
  }, [open])

  if (!selectedMachine) return null

  const SelectedIcon = getMachineIcon(selectedMachine)

  async function commitRename(machine: MachineSummary) {
    const nextLabel = draftLabel.trim()
    if (!nextLabel || savingMachineId) return
    setSavingMachineId(machine.id)
    try {
      await onRenameMachine(machine.id, nextLabel)
      setEditingMachineId(null)
      setDraftLabel("")
    } finally {
      setSavingMachineId(null)
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex min-w-0 items-center gap-2 rounded-lg text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact ? "px-1.5 py-1 text-xs" : "px-2 py-1.5",
          buttonClassName
        )}
      >
        <SelectedIcon className={cn("shrink-0 text-muted-foreground", compact ? "h-3.5 w-3.5" : "h-6 w-6")} />
        <span className="min-w-0 truncate text-foreground">{selectedMachine.displayName}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogBody className="space-y-4">
            <DialogTitle>Machines</DialogTitle>
            <div className="space-y-2">
              {machines.map((machine) => {
                const Icon = getMachineIcon(machine)
                const isSelected = machine.id === selectedMachineId
                const isEditing = editingMachineId === machine.id
                const isSaving = savingMachineId === machine.id
                const projectCount = projectCounts.get(machine.id) ?? 0

                return (
                  <div
                    key={machine.id}
                    className={cn(
                      "grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-border bg-card p-3",
                      isSelected && "border-primary/50 bg-muted/50"
                    )}
                  >
                    {isEditing ? (
                      <div className="flex min-w-0 items-center gap-3">
                        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <Input
                            value={draftLabel}
                            onChange={(event) => setDraftLabel(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void commitRename(machine)
                              if (event.key === "Escape") setEditingMachineId(null)
                            }}
                            className="h-8"
                            autoFocus
                          />
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={machine.enabled === false}
                        onClick={() => {
                          onSelectMachine(machine.id)
                          setOpen(false)
                        }}
                        className="flex min-w-0 items-center gap-3 text-left disabled:opacity-50"
                      >
                        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <>
                            <span className="block truncate text-sm font-medium text-foreground">{machine.displayName}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {projectCount} project{projectCount === 1 ? "" : "s"} indexed
                              {machine.enabled === false ? " · disabled" : ""}
                            </span>
                          </>
                        </span>
                      </button>
                    )}
                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={isSaving || !draftLabel.trim()}
                            onClick={() => void commitRename(machine)}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={isSaving}
                            onClick={() => setEditingMachineId(null)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditingMachineId(machine.id)
                            setDraftLabel(machine.displayName || getFallbackLabel(machine))
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  )
}
