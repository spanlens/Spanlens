import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * Dashboard card, matching the `Dashboard v2` boards in Figma
 * (file XCx3NR1is1GA3H6mVfLz7J): 16px radius, 1px hairline, 20px side padding
 * and 18px top/bottom, with a 14px gap between the head and the body. The
 * card fill equals the page fill, so the hairline and the soft shadow are what
 * separate it from the canvas.
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-card border bg-card text-card-foreground shadow-card', className)}
      {...props}
    />
  ),
)
Card.displayName = 'Card'

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1 px-5 pb-3.5 pt-[18px]', className)} {...props} />
  ),
)
CardHeader.displayName = 'CardHeader'

/* Card titles are 13.5px Geist SemiBold in the dashboard boards, not display type. */
const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-[13.5px] font-semibold leading-[1.4] tracking-tight text-text', className)}
      {...props}
    />
  ),
)
CardTitle.displayName = 'CardTitle'

/* Card subtitles are 11px Geist Mono, sitting one ink step back from the title. */
const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('font-mono text-[11px] leading-[1.4] text-text-faint', className)} {...props} />
))
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-5 pb-[18px] pt-0', className)} {...props} />
  ),
)
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center px-5 pb-[18px] pt-0', className)} {...props} />
  ),
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
