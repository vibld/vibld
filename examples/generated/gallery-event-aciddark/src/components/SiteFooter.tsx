import { Link } from 'react-router-dom';

const footerLinks = [
  { label: 'Home', path: '/' },
  { label: 'Lineup', path: '/lineup' },
  { label: 'Schedule', path: '/schedule' },
  { label: 'Tickets', path: '/tickets' },
  { label: 'Directions', path: '/directions' },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background py-8">
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          <p className="text-sm text-muted-foreground">
            Electric Fork Festival
          </p>
          <nav className="flex gap-4">
            {footerLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Electric Fork Festival. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
