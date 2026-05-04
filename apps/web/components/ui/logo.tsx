import Image from 'next/image'
import { cn } from '@/lib/utils'

interface LogoMarkProps {
  size?: number
  className?: string
}

/**
 * Spanlens 앱 아이콘 마크.
 * 텍스트 없이 아이콘만 표시합니다.
 */
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
