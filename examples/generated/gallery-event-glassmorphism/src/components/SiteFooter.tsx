import { Link } from "react-router-dom";
import { Globe, Mail, Rss } from "lucide-react";

const quickLinks = [
  { label: "Home", to: "/" },
  { label: "Lineup", to: "/lineup" },
  { label: "Schedule", to: "/schedule" },
  { label: "Tickets", to: "/tickets" },
  { label: "Directions", to: "/directions" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-glass-border bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 py-8 sm:px-6 md:flex-row lg:px-8">
        <div className="flex flex-col items-center gap-2 md:items-start">
          <span className="font-display text-lg text-accent">Fork & Flame</span>
          <p className="text-sm text-muted-foreground">
            Two days of flavor, fire, and community.
          </p>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-4" aria-label="Footer navigation">
          {quickLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a
            href="https://example.com"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Visit our website"
            className="flex size-11 items-center justify-center rounded-full border border-glass-border text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Globe className="size-5" />
          </a>
          <a
            href="mailto:hello@forkandflame.com"
            aria-label="Email us"
            className="flex size-11 items-center justify-center rounded-full border border-glass-border text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Mail className="size-5" />
          </a>
          <a
            href="/rss"
            aria-label="RSS feed"
            className="flex size-11 items-center justify-center rounded-full border border-glass-border text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Rss className="size-5" />
          </a>
        </div>
        <p className="text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Fork & Flame Weekend. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
