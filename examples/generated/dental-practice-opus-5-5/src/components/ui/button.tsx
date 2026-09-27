import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full text-body font-medium transition-[background-color,color,border-color] duration-400 ease-organic disabled:pointer-events-none disabled:opacity-70 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover',
        outline:
          'border border-foreground/30 bg-transparent text-foreground hover:border-foreground/50 hover:bg-secondary active:bg-secondary',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent active:bg-accent',
        ghost: 'text-foreground hover:bg-muted active:bg-muted',
      },
      size: {
        default: 'h-11 px-5',
        sm: 'h-11 px-4',
        lg: 'h-13 px-7',
        icon: 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
