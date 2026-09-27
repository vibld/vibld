import { ArrowUp, Bean } from 'lucide-react';

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-page flex-col gap-8 px-5 py-12 md:flex-row md:items-end md:justify-between md:px-10">
        <div className="max-w-md">
          <p className="flex items-center gap-2 font-display text-xl font-semibold tracking-[-0.01em]">
            <Bean className="size-5 text-primary" aria-hidden="true" />
            Wrenfield Coffee Roasters
          </p>
          <p className="mt-3 text-base text-muted-foreground">
            Roasting Tuesdays and Fridays in Asheville, North Carolina. The Saturday counter is open 9am to 1pm.
          </p>
          <p className="mt-6 text-sm text-muted-foreground">© {year} Wrenfield Coffee Roasters</p>
        </div>
        <a
          href="#top"
          className="group inline-flex min-h-11 cursor-pointer items-center gap-2 self-start rounded-pill px-4 font-semibold transition-colors duration-150 hover:bg-muted active:bg-secondary md:self-auto"
        >
          <ArrowUp
            className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5 motion-reduce:transition-none"
            aria-hidden="true"
          />
          Back to top
        </a>
      </div>
    </footer>
  );
}
