import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Menu, ExternalLink } from "lucide-react";
import { motion } from "motion/react";
import { fadeScale } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

const navItems = [
  { href: "#/installation", label: "Installation" },
  { href: "#/quick-start", label: "Quick start" },
  { href: "#/reference", label: "Reference" },
];

export default function SiteLayout({ children }: { children: ReactNode }) {
  const [activePath, setActivePath] = useState(
    typeof window !== "undefined" ? window.location.hash || "#/" : "#/"
  );
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    const onHashChange = () => {
      setActivePath(window.location.hash || "#/");
      setSheetOpen(false);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <motion.a
            href="#/"
            className="flex items-center gap-2"
            initial="hidden"
            animate="show"
            variants={fadeScale}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-display text-sm font-semibold">
              M
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">
              Mantle
            </span>
            <span className="hidden rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground sm:inline-block">
              v0.8.1
            </span>
          </motion.a>

          <nav className="hidden items-center gap-6 md:flex">
            {navItems.map((item) => {
              const isActive = activePath === item.href;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`text-sm transition-colors ${
                    isActive
                      ? "text-primary underline underline-offset-4"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                </a>
              );
            })}
            <a
              href="https://github.com/mantle-cli/mantle"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              GitHub
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </nav>

          <div className="md:hidden">
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open navigation">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <SheetHeader className="text-left">
                  <SheetTitle className="font-display text-xl">Mantle</SheetTitle>
                  <SheetDescription className="text-sm text-muted-foreground">
                    Documentation
                  </SheetDescription>
                </SheetHeader>
                <nav className="mt-6 flex flex-col gap-1">
                  {navItems.map((item) => {
                    const isActive = activePath === item.href;
                    return (
                      <a
                        key={item.href}
                        href={item.href}
                        className={`rounded-md px-3 py-2 text-base transition-colors ${
                          isActive
                            ? "bg-accent text-primary"
                            : "text-foreground hover:bg-muted"
                        }`}
                      >
                        {item.label}
                      </a>
                    );
                  })}
                  <a
                    href="https://github.com/mantle-cli/mantle"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-md px-3 py-2 text-base text-foreground hover:bg-muted"
                  >
                    GitHub
                    <ExternalLink className="size-4" aria-hidden="true" />
                  </a>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="min-h-[calc(100vh-4rem)]">{children}</main>

      <footer className="border-t border-border/80 bg-muted/40">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-display text-xs font-semibold">
                M
              </span>
              <span className="font-display text-base font-semibold">Mantle CLI</span>
            </div>
            <p className="text-sm text-muted-foreground">
              A static site generator that treats prose as the interface.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <a href="#/installation" className="text-muted-foreground hover:text-foreground">
              Installation
            </a>
            <a href="#/quick-start" className="text-muted-foreground hover:text-foreground">
              Quick start
            </a>
            <a href="#/reference" className="text-muted-foreground hover:text-foreground">
              Reference
            </a>
            <a href="#/" className="text-muted-foreground hover:text-foreground">
              Home
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
