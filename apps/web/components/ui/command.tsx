'use client'

import * as React from 'react'
import { Command as CmdkCommand } from 'cmdk'
import { cn } from '@/lib/utils'

const Command = React.forwardRef<
  React.ElementRef<typeof CmdkCommand>,
  React.ComponentPropsWithoutRef<typeof CmdkCommand>
>(({ className, ...props }, ref) => (
  <CmdkCommand
    ref={ref}
    className={cn(
      'flex h-full w-full flex-col overflow-hidden rounded-[10px] bg-bg text-text',
      className,
    )}
    {...props}
  />
))
Command.displayName = CmdkCommand.displayName

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CmdkCommand.Input>,
  React.ComponentPropsWithoutRef<typeof CmdkCommand.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center border-b border-border px-4" cmdk-input-wrapper="">
    <CmdkCommand.Input
      ref={ref}
      className={cn(
        'flex h-11 w-full bg-transparent py-3 text-[13px] text-text placeholder:text-text-faint outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  </div>
))
CommandInput.displayName = CmdkCommand.Input.displayName

const CommandList = React.forwardRef<
  React.ElementRef<typeof CmdkCommand.List>,
  React.ComponentPropsWithoutRef<typeof CmdkCommand.List>
>(({ className, ...props }, ref) => (
  <CmdkCommand.List
    ref={ref}
    className={cn('max-h-[340px] overflow-y-auto overflow-x-hidden', className)}
    {...props}
  />
))
CommandList.displayName = CmdkCommand.List.displayName

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CmdkCommand.Empty>,
  React.ComponentPropsWithoutRef<typeof CmdkCommand.Empty>
>((props, ref) => (
  <CmdkCommand.Empty
    ref={ref}
    className="py-8 text-center text-[13px] text-text-faint"
    {...props}
  />
))
CommandEmpty.displayName = CmdkCommand.Empty.displayName

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CmdkCommand.Group>,
  React.ComponentPropsWithoutRef<typeof CmdkCommand.Group>
>(({ className, ...props }, ref) => (
  <CmdkCommand.Group
    ref={ref}
    className={cn(
      'overflow-hidden p-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[9.5px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-text-faint',
      className,
    )}
    {...props}
  />
))
CommandGroup.displayName = CmdkCommand.Group.displayName

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CmdkCommand.Separator>,
  React.ComponentPropsWithoutRef<typeof CmdkCommand.Separator>
>(({ className, ...props }, ref) => (
  <CmdkCommand.Separator
    ref={ref}
    className={cn('h-px bg-border mx-1 my-1', className)}
    {...props}
  />
))
CommandSeparator.displayName = CmdkCommand.Separator.displayName

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CmdkCommand.Item>,
  React.ComponentPropsWithoutRef<typeof CmdkCommand.Item>
>(({ className, ...props }, ref) => (
  <CmdkCommand.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-2.5 rounded-[5px] px-3 py-[7px] text-[13px] text-text-muted outline-none transition-colors',
      'data-[selected=true]:bg-bg-muted data-[selected=true]:text-text',
      'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
      className,
    )}
    {...props}
  />
))
CommandItem.displayName = CmdkCommand.Item.displayName

export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandSeparator,
  CommandItem,
}
