import { AtSign, Mail } from 'lucide-react';

export default function SiteFooter() {
  return (
    <footer className='mx-auto w-full max-w-[1200px] px-[clamp(20px,4vw,48px)] py-12'>
      <div className='flex flex-col items-center justify-between gap-6 border-t border-border pt-8 sm:flex-row'>
        <p className='text-sm text-muted-foreground'>© 2026 Mara Voss</p>
        <a href='mailto:hello@maravoss.photo' className='text-sm font-medium text-foreground hover:text-primary'>hello@maravoss.photo</a>
        <div className='flex items-center gap-2'>
          <a
            href='https://instagram.com'
            target='_blank'
            rel='noreferrer'
            aria-label='Instagram'
            className='flex size-11 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
          >
            <AtSign className='size-4' aria-hidden='true' />
          </a>
          <a
            href='mailto:hello@maravoss.photo'
            aria-label='Email'
            className='flex size-11 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
          >
            <Mail className='size-4' aria-hidden='true' />
          </a>
        </div>
      </div>
    </footer>
  );
}
