import { Copy, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../context/ToastContext';

/** A flag or password for the admin panel: hidden until "show", with a copy button. */
export function SecretField({ value, label, initiallyShown = false }: { value: string; label: string; initiallyShown?: boolean }) {
  const { toast } = useToast();
  const [shown, setShown] = useState(initiallyShown);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast('success', 'Copied to clipboard', label);
    } catch {
      setShown(true);
      toast('error', 'Could not copy', 'Select the text and copy it manually.');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <code
        className={`min-w-0 flex-1 break-all rounded-md border border-accent-500/40 bg-navy-950 px-3 py-2.5 font-mono text-sm ${shown ? 'select-all text-accent-200' : 'select-none text-slate-500'}`}
        aria-label={shown ? `${label}: ${value}` : `${label} (hidden)`}
      >
        {shown ? value : '•'.repeat(Math.min(24, Math.max(8, value.length)))}
      </code>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setShown((s) => !s)} aria-label={shown ? `Hide ${label}` : `Show ${label}`} title={shown ? 'Hide' : 'Show'}>
        {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
      <button type="button" className="btn-ghost btn-sm" onClick={copy} aria-label={`Copy ${label}`} title="Copy">
        <Copy className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
