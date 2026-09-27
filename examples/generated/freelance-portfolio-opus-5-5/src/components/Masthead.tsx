const links = [
  { href: '#work', label: 'Work' },
  { href: '#about', label: 'About' },
  { href: '#commissions', label: 'Commissions' },
];

export function Masthead() {
  return (
    <header id="top" className="page-x mx-auto max-w-page">
      <a
        href="#work"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
      >
        Skip to the work
      </a>
      <div className="flex flex-col gap-1 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex items-baseline gap-5">
          <a
            href="#top"
            className="inline-flex min-h-11 items-center font-display text-title transition-colors hover:text-primary"
          >
            Ines Marlow
          </a>
          <span className="hidden font-mono text-label uppercase text-muted-foreground md:inline">
            Illustration and picture books
          </span>
        </div>
        <nav aria-label="Primary">
          <ul className="flex flex-wrap gap-x-6">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="inline-flex min-h-11 items-center text-base decoration-primary decoration-1 underline-offset-4 transition-colors hover:text-primary hover:underline"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
