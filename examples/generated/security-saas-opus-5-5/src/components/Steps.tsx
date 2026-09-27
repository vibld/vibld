import { Reveal } from '@/components/Reveal';

const steps = [
  {
    time: 'Minute 0',
    title: 'Add your root domain',
    body: 'Type it in, prove you control it with a DNS TXT record, and choose where alerts go.',
  },
  {
    time: 'Minute 20',
    title: 'Review the asset map',
    body: 'Tripline lists every host it attributes to you. Mark anything that belongs to a vendor or a retired project, and it drops out of scope.',
  },
  {
    time: 'Hour 1',
    title: 'Read ranked findings',
    body: 'The first full scan finishes and findings arrive ranked by how reachable each one is and how much damage it could do.',
  },
  {
    time: 'Every 6 hours',
    title: 'Get the diff',
    body: 'Each rescan compares against the last. You hear about what is new, what got worse and what you fixed.',
  },
];

export function Steps() {
  return (
    <section aria-labelledby="setup-heading" className="border-y border-border bg-card py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="max-w-2xl">
          <p className="font-display text-label font-semibold uppercase text-muted-foreground">Setup</p>
          <h2 id="setup-heading" className="mt-4 font-display text-title font-bold text-card-foreground">
            From domain to first findings in about an hour.
          </h2>
        </Reveal>
        <ol className="mt-14 grid gap-10 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li key={step.time} className="border-t border-foreground/20 pt-6">
              <Reveal delay={index * 0.04}>
                <p className="font-display text-heading font-semibold text-card-foreground">{step.time}</p>
                <h3 className="mt-3 font-semibold text-card-foreground">{step.title}</h3>
                <p className="mt-2 text-muted-foreground">{step.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
