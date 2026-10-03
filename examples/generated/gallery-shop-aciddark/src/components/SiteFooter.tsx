export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto max-w-6xl px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <p className="font-display text-base font-semibold text-foreground">Acid Wick</p>
        <p className="text-sm text-muted-foreground">
          Demo cart, keeps items in your browser. No checkout, no payment.
        </p>
        <p className="text-sm text-muted-foreground">© {year}</p>
      </div>
    </footer>
  );
}
