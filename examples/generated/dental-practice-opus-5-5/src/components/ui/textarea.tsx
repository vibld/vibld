import * as React from 'react';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-28 w-full rounded-2xl border border-input bg-background px-4 py-3 text-body text-foreground transition-colors duration-300 ease-organic placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-70 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
