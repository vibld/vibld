import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  className?: string;
}

export default function CodeBlock({
  code,
  language,
  filename,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);

  const handleCopy = async () => {
    if (copying) return;
    setCopying(true);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = code;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Copy failed:", error);
    } finally {
      setCopying(false);
    }
  };

  return (
    <div
      className={`group relative overflow-hidden rounded-lg border border-border bg-card font-mono text-sm ${className ?? ""}`}
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {filename ?? language ?? "shell"}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          disabled={copying}
          aria-label={copied ? "Copied to clipboard" : "Copy code"}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {copied ? (
            <Check className="size-4 text-primary" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 leading-relaxed text-foreground/90">
        <code>{code}</code>
      </pre>
    </div>
  );
}
