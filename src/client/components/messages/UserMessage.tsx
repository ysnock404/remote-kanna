import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { createMarkdownComponents } from "./shared"

interface Props {
  content: string
  onOpenLocalLink?: (target: { path: string; line?: number; column?: number }) => void
}

export function UserMessage({ content, onOpenLocalLink }: Props) {
  return (
    <div className="flex gap-2 justify-end">
      <div className="max-w-[85%] sm:max-w-[80%] rounded-[20px] py-1.5 px-3.5 bg-muted text-primary border border-border prose prose-sm prose-invert [&_p]:whitespace-pre-line">
        <Markdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents({ onOpenLocalLink })}>{content}</Markdown>
      </div>
    </div>
  )
}
