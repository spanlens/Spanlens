import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/*
 * Buttons follow the `Button` component set in Figma
 * (file XCx3NR1is1GA3H6mVfLz7J, page `Components`).
 *
 * Two families share one shape language. Marketing calls to action are pills
 * at 52px with a 15.5px SemiBold label; dashboard controls are the same
 * palette at 10px radius and 36px so they line up with inputs and selects.
 *
 * `ghost` and `outline` hover onto a neutral chip, not onto the accent. The
 * design carries a single accent and spends it on the primary action only, so
 * a quiet control must not flash orange on hover.
 *
 * State timings come from the same component set: 220ms into hover, 120ms into
 * pressed. The press is deliberately the faster of the two, so the button feels
 * like it answers the click and then settles back. `active:scale-[0.98]` is the
 * pressed state; it is a transform, so it is listed alongside colour in the
 * transition property rather than left to the default.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,transform,opacity] duration-[220ms] ease-out active:scale-[0.98] active:duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        signal: 'bg-accent text-accent-fg hover:bg-accent-strong',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-bg-elev text-text hover:border-border-strong hover:bg-bg-muted',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-bg-chip',
        ghost: 'text-text-muted hover:bg-bg-chip hover:text-text',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        /* Marketing call to action: pill, 52px, 15.5px SemiBold. */
        hero: 'h-[52px] rounded-full px-7 text-[15.5px] font-semibold',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
