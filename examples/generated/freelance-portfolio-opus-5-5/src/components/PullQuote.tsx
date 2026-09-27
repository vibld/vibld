import { Reveal } from '@/components/Reveal';

export function PullQuote() {
  return (
    <section aria-label="Pull quote" className="page-x mx-auto max-w-page">
      <figure className="grid gap-6 border-t border-foreground pt-6 lg:grid-cols-12">
        <p className="font-mono text-label uppercase text-muted-foreground lg:col-span-2">From the studio notebook</p>
        <Reveal className="lg:col-span-9 lg:col-start-3">
          <blockquote className="font-display text-quote italic text-balance">
            I start every picture with the light source and paint backwards from it. If the lamp is wrong, nothing else in
            the room will sit still.
          </blockquote>
        </Reveal>
        <figcaption className="font-mono text-caption text-muted-foreground lg:col-span-9 lg:col-start-3">
          Ines Marlow, on how a picture begins
        </figcaption>
      </figure>
    </section>
  );
}
