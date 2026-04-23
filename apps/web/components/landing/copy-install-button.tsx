'use client'
import { useState } from 'react'

export function CopyInstallButton() {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText('npx @spanlens/cli init').then(() => {
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
