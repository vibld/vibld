import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-12 w-full min-w-0 rounded-2xl border border-input bg-background px-4 text-body text-foreground transition-colors duration-300 ease-organic placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-70 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
