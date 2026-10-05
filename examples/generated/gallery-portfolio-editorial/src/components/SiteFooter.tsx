import { ArrowUp } from 'lucide-react';

export function SiteFooter() {
  return (
    <footer className='border-t border-border bg-background'>
      <div className='mx-auto flex w-full max-w-6xl flex-col items-start gap-4 px-6 py-6 sm:flex-row sm:items-center sm:justify-between'>
        <p className='text-sm text-muted-foreground'>© 2026 Lena Voss. All rights reserved.</p>
        <a href='#hero' className='inline-flex items-center gap-2 p-2 text-sm font-medium text-foreground underline-offset-4 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'>
          Back to top
          <ArrowUp className='size-4' aria-hidden='true' />
        </a>
      </div>
    </footer>
  );
}
