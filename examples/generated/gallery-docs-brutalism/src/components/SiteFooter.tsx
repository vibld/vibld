import { ExternalLink } from 'lucide-react';

export default function SiteFooter() {
  return (
    <footer className='max-w-[1200px] mx-auto px-[var(--space-gutter)] py-[var(--space-gutter)] border-t-2 border-border'>
      <div className='flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4'>
        <p className='text-body'>rig is MIT licensed and open source.</p>
        <a
          href='#'
          className='inline-flex items-center gap-2 text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        >
          View on GitHub
          <ExternalLink className='size-4' aria-hidden='true' />
        </a>
      </div>
    </footer>
  );
}
