import { Reveal } from '@/components/Reveal';

const facts = [
  { term: 'Based in', detail: 'Bristol, UK' },
  { term: 'Mediums', detail: 'Gouache, ink, two colour risograph' },
  { term: 'Takes on', detail: 'Editorial spots, book covers, picture books, packaging' },
  { term: 'Turnaround', detail: 'Spot illustrations in five working days, covers in three to four weeks' },
];

export function About() {
  return (
    <section id="about" aria-labelledby="about-title" className="page-x mx-auto max-w-page py-20 lg:py-32">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-x-6 lg:gap-y-14">
        <Reveal className="lg:col-span-3">
          <p className="font-mono text-label uppercase text-muted-foreground">About</p>
          <h2 id="about-title" className="mt-4 font-display text-headline">
            A short biography
          </h2>
        </Reveal>

        <div className="space-y-5 lg:col-span-9 lg:columns-2 lg:gap-x-12">
          <p className="dropcap">
            Ines Marlow grew up above a hardware shop in Stroud and now paints most mornings at a kitchen table in Easton,
            Bristol. She studied printmaking, spent six years laying out pages for a regional newspaper, and went freelance
            in 2019 when the drawings in the margins started to take over.
          </p>
          <p>
            Most pictures begin as pencil thumbnails no bigger than a postage stamp. Finals are gouache on hot pressed
            paper, sometimes with an ink line, scanned at 600 dpi and checked against the printer's proofs. Shorter runs
            become two colour risograph editions, printed at a shared studio on Stokes Croft.
          </p>
          <p>
            She is left handed, works to the radio, and never throws away a failed painting. The backs are for colour
            tests.
          </p>
        </div>

        <dl className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:col-span-9 lg:col-start-4 xl:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.term} className="border-t border-foreground pt-3">
              <dt className="font-mono text-label uppercase text-muted-foreground">{fact.term}</dt>
              <dd className="mt-2 text-body">{fact.detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
