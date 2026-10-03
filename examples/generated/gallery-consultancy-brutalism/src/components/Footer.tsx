import { Mail } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-black text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Hale &amp; Voss. All rights reserved.</p>
        <a
          href="mailto:hello@halevoss.com"
          className="inline-flex items-center gap-2 text-sm font-bold underline-offset-4 hover:underline"
        >
          <Mail className="size-4" aria-hidden="true" />
          hello@halevoss.com
        </a>
      </div>
    </footer>
  );
}
