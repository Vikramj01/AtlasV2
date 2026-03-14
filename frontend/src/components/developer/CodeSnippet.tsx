import { useState } from 'react';
import { cn } from '@/lib/utils';

interface CodeSnippetProps {
  code: string;
  language?: string;
  label?: string;
  className?: string;
}

export function CodeSnippet({ code, label, className }: CodeSnippetProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers that block clipboard API
      const el = document.createElement('textarea');
      el.value = code;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className={cn('rounded-lg border border-border bg-zinc-950 overflow-hidden', className)}>
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-xs text-zinc-400 font-mono">{label ?? 'dataLayer code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            'rounded px-2 py-1 text-xs font-medium transition-colors',
            copied
              ? 'bg-green-500/20 text-green-400'
              : 'bg-white/10 text-zinc-300 hover:bg-white/20',
          )}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      {/* Code */}
      <pre className="overflow-x-auto px-4 py-3 text-xs leading-relaxed text-zinc-200 font-mono whitespace-pre-wrap break-words">
        {code}
      </pre>
    </div>
  );
}
