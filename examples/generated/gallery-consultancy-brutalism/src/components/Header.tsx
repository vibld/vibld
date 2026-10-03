import { cn } from "@/lib/utils";

interface HeaderProps {
  currentPage: "home" | "contact";
  onNavigate: (page: "home" | "contact") => void;
}

export function Header({ currentPage, onNavigate }: HeaderProps) {
  return (
    <header className="border-b-4 border-black bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <button
          type="button"
          onClick={() => onNavigate("home")}
          className="font-display text-2xl uppercase tracking-tight leading-none"
          aria-label="Hale & Voss home"
        >
          Hale &amp; Voss
        </button>
        <nav className="flex gap-2" aria-label="Main navigation">
          <button
            type="button"
            onClick={() => onNavigate("home")}
            className={cn(
              "border-2 border-black px-4 py-2 text-sm font-bold uppercase",
              currentPage === "home"
                ? "bg-black text-white"
                : "bg-white text-black hover:bg-muted"
            )}
          >
            Home
          </button>
          <button
            type="button"
            onClick={() => onNavigate("contact")}
            className={cn(
              "border-2 border-black px-4 py-2 text-sm font-bold uppercase",
              currentPage === "contact"
                ? "bg-black text-white"
                : "bg-white text-black hover:bg-muted"
            )}
          >
            Contact
          </button>
        </nav>
      </div>
    </header>
  );
}
