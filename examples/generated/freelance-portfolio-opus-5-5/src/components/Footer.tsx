import { ArrowUp } from 'lucide-react';

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="page-x mx-auto max-w-page py-10">
      <div className="flex flex-col gap-4 border-t border-foreground pt-5 md:flex-row md:items-start md:justify-between md:gap-10">
        <p className="font-mono text-caption">© {year} Ines Marlow</p>
        <p className="max-w-[40rem] text-base text-muted-foreground">
          Ines Marlow is a placeholder name. The plates are drawn in code as stand-ins for scanned artwork; replace both
          with your own.
        </p>
        <a
          href="#top"
          className="inline-flex min-h-11 items-center gap-2 self-start text-base decoration-primary underline-offset-4 transition-colors hover:text-primary hover:underline"
        >
          Back to top
          <ArrowUp className="size-4" aria-hidden="true" />
        </a>
      </div>
    </footer>
  );
}
