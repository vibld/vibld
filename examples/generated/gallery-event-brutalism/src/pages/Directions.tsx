import { MapPin } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';

export default function Directions() {
  return (
    <div>
      <section className="border-2 border-foreground bg-secondary p-6 md:p-12 shadow-hard">
        <p className="font-mono text-sm uppercase tracking-widest">Directions</p>
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl uppercase leading-none mt-2">
          Find the rail yard
        </h1>
        <p className="mt-4 text-lg font-medium max-w-2xl">
          Old Rail Yard, 418 Foundry Street. The festival entrance is on the east side, under the water tower.
        </p>
      </section>

      <div className="mt-8 grid md:grid-cols-2 gap-8">
        <div className="border-2 border-foreground bg-background p-6 shadow-hard">
          <h2 className="font-display text-2xl uppercase mb-3">Public transit</h2>
          <p className="text-sm">
            Take the Metro Red Line to Foundry station. Exit toward Foundry Street and walk east for 5 minutes.
            Bus 14 stops at Foundry and 4th, one block from the gate.
          </p>
        </div>
        <div className="border-2 border-foreground bg-background p-6 shadow-hard">
          <h2 className="font-display text-2xl uppercase mb-3">Parking</h2>
          <p className="text-sm">
            Limited on-site parking at 400 Foundry Street, $10 per day. Gates open at 10:30 AM.
            Bike racks are available at the main entrance.
          </p>
        </div>
      </div>

      <div className="mt-8 border-2 border-foreground shadow-hard bg-secondary p-2">
        <div className="border-2 border-foreground bg-background h-64 md:h-96 flex flex-col items-center justify-center gap-2">
          <MapPin className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-mono text-sm uppercase text-muted-foreground">Map placeholder</p>
          <p className="text-xs text-muted-foreground">Static map will appear here</p>
        </div>
      </div>

      <div className="mt-8">
        <a
          href="https://maps.google.com/?q=Old+Rail+Yard+418+Foundry+Street"
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: 'default', size: 'lg' })}
        >
          Open in Google Maps
        </a>
      </div>
    </div>
  );
}
