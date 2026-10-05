import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { pulse } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface CodeBlockProps {
  code: string;
  filename?: string;
  className?: string;
}

export function CodeBlock({ code, filename, className }: CodeBlockProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = code;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
      } catch {
        // Ignore copy failure
      }
      document.body.removeChild(textarea);
    } finally {
      setIsLoading(false);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className={cn('overflow-hidden rounded-md border border-border bg-card', className)}>
      {filename && (
        <div className="flex items-center justify-between border-b border-border bg-secondary/40 px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">{filename}</span>
        </div>
      )}
      <div className="relative">
        <pre className="overflow-x-auto p-4 pr-16 text-sm leading-relaxed">
          <code className="font-mono text-foreground">{code}</code>
        </pre>
        <div className="absolute right-2 top-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCopy}
            disabled={isLoading}
            aria-label={copied ? 'Copied' : 'Copy code'}
            className="h-11 w-11 text-muted-foreground hover:text-foreground"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : copied ? (
              <motion.span
                variants={pulse}
                initial="hidden"
                animate="show"
                className="flex"
              >
                <Check className="h-4 w-4 text-primary" />
              </motion.span>
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
