import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm font-medium leading-none text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
