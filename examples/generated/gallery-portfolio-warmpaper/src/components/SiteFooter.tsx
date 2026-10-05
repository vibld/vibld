export default function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-12 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div>
          <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            Let's work together
          </h2>
          <p className="mt-2 text-muted-foreground">
            I'm available for commissions and editorial assignments.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <a
            href="mailto:elena@elenamarchetti.com"
            className="text-lg font-medium text-primary underline-offset-4 transition-colors hover:text-primary/80 hover:underline"
          >
            elena@elenamarchetti.com
          </a>
          <p className="text-sm text-muted-foreground">
            © {year} Elena Marchetti. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
