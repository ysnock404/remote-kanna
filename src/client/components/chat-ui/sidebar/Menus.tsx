import type { ReactNode } from "react"
import { Code, Copy, FolderOpen, Trash2 } from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../ui/context-menu"
import { Kbd, KbdGroup } from "../../ui/kbd"
import { formatHotkeyLabel } from "../../ui/tooltip"

function ContextMenuShortcut({ shortcut }: { shortcut?: string[] }) {
  const firstShortcut = shortcut?.[0]
  if (!firstShortcut) return null

  return (
    <KbdGroup className="ml-auto shrink-0 pl-4 text-muted-foreground">
      {firstShortcut.split("+").map((key, index) => (
        <Kbd key={`${key}-${index}`} className="h-4 min-w-4 px-1 text-[10px]">
          {formatHotkeyLabel(key)}
        </Kbd>
      ))}
    </KbdGroup>
  )
}

export function ProjectSectionMenu({
  editorLabel,
  finderShortcut,
  editorShortcut,
  onCopyPath,
  onOpenInFinder,
  onOpenInEditor,
  onRemove,
  children,
}: {
  editorLabel: string
  finderShortcut?: string[]
  editorShortcut?: string[]
  onCopyPath: () => void
  onOpenInFinder: () => void
  onOpenInEditor: () => void
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            onCopyPath()
          }}
        >
          <Copy className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Copy Path</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            onOpenInFinder()
          }}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Show in Finder</span>
          <ContextMenuShortcut shortcut={finderShortcut} />
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            onOpenInEditor()
          }}
        >
          <Code className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Open in {editorLabel}</span>
          <ContextMenuShortcut shortcut={editorShortcut} />
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          className="text-destructive dark:text-red-400 hover:bg-destructive/10 focus:bg-destructive/10 dark:hover:bg-red-500/20 dark:focus:bg-red-500/20"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Remove</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
