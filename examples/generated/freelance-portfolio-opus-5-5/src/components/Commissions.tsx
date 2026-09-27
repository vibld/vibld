import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Check, CircleAlert, Copy, LoaderCircle, Mail } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Reveal } from '@/components/Reveal';
import { lift, press, pressSpring } from '@/lib/motion';

// Placeholder inbox: the .example domain never delivers mail.
const EMAIL = 'studio@inesmarlow.example';

const brief = [
  'The deadline and the file format you need',
  'The printed size, including any bleed',
  'Where the picture will run, and for how long',
  'Two or three references, if you have them',
];

type CopyStatus = 'idle' | 'copying' | 'copied' | 'failed';

export function Commissions() {
  const [status, setStatus] = useState<CopyStatus>('idle');

  useEffect(() => {
    if (status !== 'copied' && status !== 'failed') return undefined;
    const timer = window.setTimeout(() => setStatus('idle'), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function copyAddress() {
    setStatus('copying');
    try {
      await navigator.clipboard.writeText(EMAIL);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }

  const copying = status === 'copying';

  return (
    <section
      id="commissions"
      aria-labelledby="commissions-title"
      className="inverse mt-20 bg-foreground text-background lg:mt-32"
    >
      <div className="page-x mx-auto grid max-w-page gap-14 py-20 lg:grid-cols-12 lg:gap-6 lg:py-32">
        <div className="lg:col-span-6">
          <Reveal>
            <p className="font-mono text-label uppercase text-inverse-muted">Commissions</p>
            <h2 id="commissions-title" className="mt-4 font-display text-headline">
              Booking from September.
            </h2>
          </Reveal>
          <p className="mt-6 max-w-[36rem] text-inverse-muted">
            Send a short brief with the deadline, the printed size and where the picture will appear. Replies go out within
            two working days with a quote and a rough schedule.
          </p>

          <a
            href={`mailto:${EMAIL}`}
            className="mt-10 inline-block font-display text-title underline decoration-inverse-muted decoration-1 underline-offset-8 transition-colors [overflow-wrap:anywhere] hover:decoration-background sm:text-quote"
          >
            {EMAIL}
          </a>

          <div className="mt-8 flex flex-wrap gap-3">
            <motion.a
              href={`mailto:${EMAIL}`}
              whileHover={lift}
              whileTap={press}
              transition={pressSpring}
              className={buttonVariants({ variant: 'inverse', size: 'lg' })}
            >
              <Mail aria-hidden="true" />
              Email the studio
            </motion.a>
            <motion.button
              type="button"
              onClick={copyAddress}
              disabled={copying}
              aria-busy={copying}
              whileTap={press}
              transition={pressSpring}
              className={buttonVariants({ variant: 'inverse-outline', size: 'lg' })}
            >
              {copying ? (
                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
              {copying ? 'Copying' : 'Copy address'}
            </motion.button>
          </div>

          <p role="status" className="mt-4 flex min-h-7 items-center gap-2 font-mono text-caption text-inverse-muted">
            {status === 'copied' ? (
              <>
                <Check className="size-4" aria-hidden="true" />
                Address copied
              </>
            ) : null}
            {status === 'failed' ? (
              <>
                <CircleAlert className="size-4" aria-hidden="true" />
                Copy failed. Select the address above instead.
              </>
            ) : null}
          </p>
        </div>

        <div className="lg:col-span-5 lg:col-start-8">
          <h3 className="font-mono text-label uppercase text-inverse-muted">What to put in the brief</h3>
          <ol className="mt-4">
            {brief.map((item, index) => (
              <li key={item} className="flex gap-5 border-t border-inverse-border py-5">
                <span className="pt-1 font-mono text-caption text-inverse-muted">0{index + 1}</span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
          <p className="mt-6 border-t border-inverse-border pt-5 font-mono text-caption text-inverse-muted">
            The address above is a placeholder. Swap it for a real inbox before publishing.
          </p>
        </div>
      </div>
    </section>
  );
}
