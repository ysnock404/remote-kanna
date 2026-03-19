import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { ProcessedTextMessage } from "./types"
import { createMarkdownComponents } from "./shared"

interface Props {
  message: ProcessedTextMessage
  onOpenLocalLink?: (target: { path: string; line?: number; column?: number }) => void
}

export function TextMessage({ message, onOpenLocalLink }: Props) {
  return (
    // <VerticalLineContainer className="w-full">
      <div className="text-pretty prose prose-sm dark:prose-invert px-0.5 w-full max-w-full space-y-4">
        <Markdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents({ onOpenLocalLink })}>{message.text}</Markdown>
      </div>
    // </VerticalLineContainer>
  )
}
