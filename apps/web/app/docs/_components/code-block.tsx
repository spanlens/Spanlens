'use client'
import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface CodeBlockProps {
  children: string
  /** Optional language hint — shown as a subtle label in the top-left. */
  language?: string
}

/**
 * Code block with a copy-to-clipboard button.
 *
 * Usage:
 *   <CodeBlock>{`npx @spanlens/cli init`}</CodeBlock>
 *   <CodeBlock language="ts">{`import { createOpenAI } from '@spanlens/sdk/openai'`}</CodeBlock>
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
    <div className="relative group my-6 not-prose">
      <pre className={`overflow-x-auto rounded-lg border border-border/40 bg-[#1a1816] px-4 text-sm leading-6 text-[#d4cfc8] shadow-sm ${language ? 'pt-9 pb-4' : 'py-4'}`}>
        <code className="font-mono">{children}</code>
      </pre>

      {language && (
        <span className="absolute top-2.5 left-4 text-[10px] uppercase tracking-wider font-semibold text-[#7c7770] select-none">
          {language}
        </span>
      )}

      <button
        type="button"
        onClick={() => void handleCopy()}
        className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md border border-border/60 bg-[#2a2826]/70 px-2 py-1 text-[11px] text-[#7c7770] opacity-0 transition-opacity hover:bg-[#2a2826] hover:text-[#d4cfc8] group-hover:opacity-100 focus:opacity-100"
        aria-label={copied ? 'Copied to clipboard' : 'Copy code to clipboard'}
      >
        {copied ? (
          <>
            <Check className="h-3 w-3" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            Copy
          </>
        )}
      </button>
    </div>
  )
}
