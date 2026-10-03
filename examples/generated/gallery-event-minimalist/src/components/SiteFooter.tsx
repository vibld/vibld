export default function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-6 py-12 md:px-12">
        <p className="font-display text-h3 text-foreground">The Long Table Food Festival</p>
        <p className="text-small text-muted-foreground">June 7 and 8, 2025</p>
        <p className="text-small text-muted-foreground">Millbrook Park, 1200 Lakeside Drive</p>
        <a
          href="mailto:hello@longtablefest.com"
          className="text-small text-accent transition-opacity duration-150 hover:opacity-[0.85]"
        >
          hello@longtablefest.com
        </a>
        <p className="mt-8 text-small text-muted-foreground">© 2025 The Long Table Food Festival</p>
      </div>
    </footer>
  );
}
