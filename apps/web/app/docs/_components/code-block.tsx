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
      <pre className="overflow-x-auto rounded-lg border border-gray-800 bg-gray-950 px-4 py-3 text-sm leading-6 text-gray-100 shadow-sm">
        <code className="font-mono">{children}</code>
      </pre>

      {language && (
        <span className="absolute top-2 left-3 text-[10px] uppercase tracking-wider font-semibold text-gray-500 select-none">
          {language}
        </span>
      )}

      <button
        type="button"
        onClick={() => void handleCopy()}
        className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md border border-gray-700/60 bg-gray-800/70 px-2 py-1 text-[11px] text-gray-300 opacity-0 transition-opacity hover:bg-gray-700 hover:text-white group-hover:opacity-100 focus:opacity-100"
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
