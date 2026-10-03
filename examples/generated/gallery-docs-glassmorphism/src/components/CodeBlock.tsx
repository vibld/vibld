import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CodeBlockProps {
  code: string;
  className?: string;
}

export default function CodeBlock({ code, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable, leave state unchanged
    }
  };

  return (
    <div
      className={cn(
        'relative rounded-lg bg-muted p-4 font-mono text-sm text-foreground',
        className,
      )}
    >
      <pre className="overflow-x-auto">
        <code>{code}</code>
      </pre>
      <button
        onClick={handleCopy}
        aria-label="Copy code"
        className="absolute right-2 top-2 flex h-11 min-h-[44px] w-11 min-w-[44px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted-foreground/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
