import { Quote } from 'lucide-react';
import { Reveal } from '@/components/Reveal';

export function Proof() {
  return (
    <section aria-label="Customer testimonial placeholder" className="py-24 lg:py-32">
      <div className="mx-auto grid max-w-6xl px-6 lg:grid-cols-12">
        <Reveal className="lg:col-span-8 lg:col-start-3">
          <figure>
            <div className="flex items-center gap-4">
              <Quote className="size-8 text-muted-foreground" aria-hidden="true" />
              <span className="rounded-pill border border-dashed border-muted-foreground px-3 py-1 font-display text-label font-semibold uppercase text-muted-foreground">
                Placeholder testimonial
              </span>
            </div>
            <blockquote className="mt-8 font-display text-title font-medium text-foreground">
              <p>Replace this with a customer's own words about a finding Tripline caught.</p>
            </blockquote>
            <figcaption className="mt-6 font-display text-label font-semibold uppercase text-muted-foreground">
              Name, role, company (placeholder)
            </figcaption>
          </figure>
          <p className="mt-12 max-w-xl text-lead text-muted-foreground">
            Until that quote exists, the trial is the proof: point it at your own domain and judge the first
            findings, which arrive within the hour.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
