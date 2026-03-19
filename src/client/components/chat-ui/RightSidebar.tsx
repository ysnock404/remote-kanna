export function RightSidebar() {
  return (
    <div className="h-full min-h-0 border-l border-border bg-background md:min-w-[300px]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-[72px] shrink-0 items-center gap-3 border-b border-border px-5">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-foreground">RightSidebar</h2>
            <p className="text-xs text-muted-foreground">Future feature placeholder</p>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-[240px] text-center">
            <p className="text-sm text-foreground">RightSidebar</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This drawer is reserved for a future feature. The layout, resize behavior, and animation are in place.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
