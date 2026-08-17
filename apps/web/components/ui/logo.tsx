import Image from 'next/image'
import { cn } from '@/lib/utils'

interface LogoMarkProps {
  size?: number
  className?: string
}

/** Spanlens app icon on its own, without the wordmark. */
export function LogoMark({ size = 20, className }: LogoMarkProps) {
  return (
    <Image
      src="/icon.png"
      alt="Spanlens"
      width={size}
      height={size}
      className={cn('shrink-0', className)}
    />
  )
}
