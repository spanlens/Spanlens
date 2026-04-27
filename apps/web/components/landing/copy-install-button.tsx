'use client'
import { useState } from 'react'

interface CopyInstallButtonProps {
  text?: string
}

export function CopyInstallButton({ text = 'npx @spanlens/cli init' }: CopyInstallButtonProps) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      onClick={handleCopy}
      className="bg-text text-bg px-3 py-2 rounded-md font-mono text-[12px] uppercase tracking-[0.04em] cursor-pointer hover:opacity-90 transition-opacity shrink-0"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}
