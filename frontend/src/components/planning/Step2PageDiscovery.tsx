import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';

const MAX_PAGES = 10;

const COMMON_PAGES = [
  { label: 'Homepage',            slug: '/' },
  { label: 'Product / Item page', slug: '/product' },
  { label: 'Category page',       slug: '/category' },
  { label: 'Cart',                slug: '/cart' },
  { label: 'Checkout',            slug: '/checkout' },
  { label: 'Order confirmation',  slug: '/order-confirmation' },
  { label: 'Pricing page',        slug: '/pricing' },
  { label: 'Contact / Lead form', slug: '/contact' },
  { label: 'Sign-up page',        slug: '/signup' },
];

function normalizePageUrl(base: string, input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  try { return new URL(trimmed, base).href; }
  catch { return trimmed; }
}

function isValidUrl(s: string): boolean {
  try { new URL(s); return true; }
  catch { return false; }
}

export function Step2PageDiscovery() {
  const navigate = useNavigate();
  const { draftSetup, prevStep, nextStep, setCurrentSession, setPages, setLoading, setError, isLoading, error } = usePlanningStore();

  const baseUrl = draftSetup.website_url ?? '';

  useEffect(() => { setError(null); }, [setError]);

  const [urls, setUrls] = useState<string[]>([baseUrl]);
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');

  function addSuggested(slug: string) {
    const full = normalizePageUrl(baseUrl, slug);
    if (!full || urls.includes(full) || urls.length >= MAX_PAGES) return;
    setUrls((prev) => [...prev, full]);
  }

  function handleAdd() {
    const normalized = normalizePageUrl(baseUrl, inputValue);
    if (!normalized) return;
    if (!isValidUrl(normalized)) { setInputError('Enter a valid URL or path (e.g. /checkout or https://…)'); return; }
    if (urls.includes(normalized)) { setInputError('This URL is already in the list.'); return; }
    if (urls.length >= MAX_PAGES) { setInputError(`Maximum ${MAX_PAGES} pages per session.`); return; }
    setUrls((prev) => [...prev, normalized]);
    setInputValue('');
    setInputError('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
  }

  function removeUrl(url: string) {
    setUrls((prev) => prev.filter((u) => u !== url));
  }

  async function handleStart() {
    if (urls.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const { session_id } = await planningApi.createSession({
        website_url: draftSetup.website_url!,
        business_type: draftSetup.business_type!,
        business_description: draftSetup.business_description,
        selected_platforms: draftSetup.selected_platforms!,
        page_urls: urls,
      });

      const { session, pages } = await planningApi.getSession(session_id);
      setCurrentSession(session);
      setPages(pages);

      navigate(`/planning/${session_id}`, { replace: true });
      nextStep();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create session';
      if (msg.includes('429') || msg.toLowerCase().includes('limit')) {
        navigate('/planning', { state: { limitReached: true, limitMessage: msg } });
        return;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const suggestedNotAdded = COMMON_PAGES.filter(({ slug }) => {
    const full = normalizePageUrl(baseUrl, slug);
    return !urls.includes(full);
  });

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <h2 className="mb-1 text-xl font-bold">Which pages should Atlas scan?</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Add up to {MAX_PAGES} pages. Atlas will visit each one and identify what to track.
      </p>

      <div className="mb-4 space-y-2">
        {urls.map((url) => (
          <div
            key={url}
            className="flex items-center justify-between rounded-lg border bg-background px-3 py-2"
          >
            <span className="truncate text-sm">{url}</span>
            {url !== baseUrl ? (
              <button
                onClick={() => removeUrl(url)}
                className="ml-2 flex-shrink-0 text-xs text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${url}`}
              >
                ✕
              </button>
            ) : (
              <Badge variant="secondary" className="ml-2 flex-shrink-0 text-xs">home</Badge>
            )}
          </div>
        ))}
      </div>

      {urls.length < MAX_PAGES && (
        <div className="mb-6">
          <div className="flex gap-2">
            <Input
              type="text"
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); setInputError(''); }}
              onKeyDown={handleKeyDown}
              placeholder="/checkout or https://example.com/checkout"
              className={inputError ? 'border-destructive' : ''}
            />
            <Button
              variant="outline"
              onClick={handleAdd}
              disabled={!inputValue.trim()}
            >
              Add
            </Button>
          </div>
          {inputError && <p className="mt-1 text-xs text-destructive">{inputError}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {MAX_PAGES - urls.length} page{MAX_PAGES - urls.length !== 1 ? 's' : ''} remaining
          </p>
        </div>
      )}

      {suggestedNotAdded.length > 0 && urls.length < MAX_PAGES && (
        <div className="mb-8">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Common pages — click to add
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestedNotAdded.map(({ label, slug }) => (
              <button
                key={slug}
                onClick={() => addSuggested(slug)}
                className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:border-brand-400 hover:text-brand-700"
              >
                + {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={prevStep} className="text-muted-foreground">
          ← Back
        </Button>
        <Button
          onClick={handleStart}
          disabled={urls.length === 0 || isLoading}
          className="bg-brand-600 hover:bg-brand-700"
        >
          {isLoading ? 'Starting scan…' : `Scan ${urls.length} page${urls.length !== 1 ? 's' : ''} →`}
        </Button>
      </div>
    </div>
  );
}
