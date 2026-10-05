import { cn } from '@/lib/utils';

interface PageHeaderProps {
  kicker?: string;
  title: string;
  lead?: string;
  align?: 'left' | 'center';
  className?: string;
}

export function PageHeader({
  kicker,
  title,
  lead,
  align = 'left',
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'mb-12 md:mb-16',
        align === 'center' ? 'text-center' : 'text-left',
        className
      )}
    >
      {kicker && (
        <p className='text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground'>
          {kicker}
        </p>
      )}
      <h1 className='mt-4 font-display text-4xl leading-tight tracking-tight text-balance md:text-5xl lg:text-6xl'>
        {title}
      </h1>
      {lead && (
        <p
          className={cn(
            'mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground',
            align === 'center' && 'mx-auto'
          )}
        >
          {lead}
        </p>
      )}
    </div>
  );
}
