export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background">
      <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-4 px-6 py-4 md:flex-row md:justify-between md:px-12">
        <a
          href="#top"
          className="font-display text-h3 text-foreground transition-opacity duration-150 hover:opacity-[0.85]"
        >
          The Long Table
        </a>
        <nav aria-label="Main navigation" className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
          <a
            href="#lineup"
            className="text-small text-foreground transition-opacity duration-150 hover:opacity-[0.85]"
          >
            Lineup
          </a>
          <a
            href="#schedule"
            className="text-small text-foreground transition-opacity duration-150 hover:opacity-[0.85]"
          >
            Schedule
          </a>
          <a
            href="#tickets"
            className="text-small text-foreground transition-opacity duration-150 hover:opacity-[0.85]"
          >
            Tickets
          </a>
          <a
            href="#directions"
            className="text-small text-foreground transition-opacity duration-150 hover:opacity-[0.85]"
          >
            Directions
          </a>
          <a
            href="#tickets"
            className="inline-flex h-11 w-full items-center justify-center bg-accent px-5 text-button text-accent-foreground transition-opacity duration-150 hover:opacity-[0.85] md:w-auto"
          >
            Get tickets
          </a>
        </nav>
      </div>
    </header>
  );
}
