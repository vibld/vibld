import { Link } from "react-router-dom";

export default function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-4 px-6 py-6 sm:flex-row">
        <p className="text-sm text-muted-foreground">
          © 2025 Crux Consulting
        </p>
        <div className="flex gap-6">
          <Link
            to="#"
            className="text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            Privacy
          </Link>
          <Link
            to="#"
            className="text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            Terms
          </Link>
        </div>
      </div>
    </footer>
  );
}
