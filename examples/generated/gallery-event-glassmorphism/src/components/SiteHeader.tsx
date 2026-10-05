import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const navItems = [
  { label: "Home", to: "/" },
  { label: "Lineup", to: "/lineup" },
  { label: "Schedule", to: "/schedule" },
  { label: "Tickets", to: "/tickets" },
  { label: "Directions", to: "/directions" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-glass-border bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          className="font-display text-xl text-accent transition-colors hover:text-primary sm:text-2xl"
        >
          Fork & Flame
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
          {navItems.map((item) => (
            <Button
              key={item.to}
              asChild
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
            >
              <Link to={item.to}>{item.label}</Link>
            </Button>
          ))}
        </nav>

        <div className="md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open navigation menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-background/95 backdrop-blur-xl">
              <SheetHeader>
                <SheetTitle className="text-foreground">Menu</SheetTitle>
                <SheetDescription className="text-muted-foreground">
                  Navigate the festival
                </SheetDescription>
              </SheetHeader>
              <nav className="mt-6 flex flex-col gap-2" aria-label="Mobile navigation">
                {navItems.map((item) => (
                  <SheetClose asChild key={item.to}>
                    <Link
                      to={item.to}
                      className="flex w-full items-center justify-start rounded-md px-3 py-2 text-base font-medium text-muted-foreground transition-colors hover:bg-accent/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {item.label}
                    </Link>
                  </SheetClose>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
