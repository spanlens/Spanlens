'use client'
import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface CodeBlockProps {
  children: string
  /** Optional language hint — shown as the label in the header bar. */
  language?: string
}

/**
 * Code block with a persistent header bar (language label + copy button).
 *
 * Usage:
 *   <CodeBlock>{`npx @spanlens/cli init`}</CodeBlock>
 *   <CodeBlock language="ts">{`import { createOpenAI } from '@spanlens/sdk/openai'`}</CodeBlock>
 *
 * Colours come from the dedicated `code-*` tokens, which are declared once with
 * no dark override because a code block stays dark in both themes the way a
 * terminal does. Do not reach for the ordinary surface tokens here, and do not
 * scope `.dark` to this subtree: that flips *every* token inside it, so a
 * status colour in a nested code sample would change meaning with the theme.
 *
 * Designed to live inside a `.prose` article. We apply `!my-0` on the pre so
 * the wrapping div owns vertical spacing, and reset inline-code styles that
 * the docs layout applies to every <code> by default.
 */
export function CodeBlock({ children, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(children)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked — silently ignore; the icon just won't switch
    }
  }

  return (
    <div className="my-6 not-prose overflow-hidden rounded-lg bg-code-bg">
      <div className="flex items-center justify-between gap-3 border-b border-code-line bg-code-head px-4 py-2.5">
        <span className="select-none font-mono text-[11.5px] text-code-faint">
          {language ?? 'code'}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1.5 rounded font-mono text-[11px] text-code-faint transition-colors hover:text-code-fg"
          aria-label={copied ? 'Copied to clipboard' : 'Copy code to clipboard'}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              copy
            </>
          )}
        </button>
      </div>

      <pre className="overflow-x-auto px-4 pb-4 pt-3.5 text-[12.5px] leading-6 text-code-fg">
        <code className="font-mono">{children}</code>
      </pre>
    </div>
  )
}
