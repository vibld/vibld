export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border/50 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="font-display text-xl font-semibold text-foreground">Crestline Consulting</p>
            <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
              A management consultancy in Minneapolis, working with leadership teams across North America on strategy, operations and organization design.
            </p>
          </div>
          <nav aria-label="Footer navigation">
            <p className="text-sm font-medium text-foreground">Explore</p>
            <div className="mt-4 flex flex-col space-y-3">
              <a href="#services" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Services</a>
              <a href="#case-studies" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Case studies</a>
              <a href="#contact" className="text-sm text-muted-foreground transition-colors hover:text-foreground">Contact</a>
            </div>
          </nav>
          <div>
            <p className="text-sm font-medium text-foreground">Contact</p>
            <div className="mt-4 flex flex-col space-y-3">
              <a href="mailto:hello@crestlineconsulting.com" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                hello@crestlineconsulting.com
              </a>
              <p className="text-sm leading-6 text-muted-foreground">Minneapolis, Minnesota and remote across North America</p>
            </div>
          </div>
        </div>
        <div className="mt-12 border-t border-border/50 pt-6">
          <p className="text-sm text-muted-foreground">© {year} Crestline Consulting. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
