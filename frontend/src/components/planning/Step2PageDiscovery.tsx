import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlanningStore } from '@/store/planningStore';
import { planningApi } from '@/lib/api/planningApi';

const MAX_PAGES = 10;

// ── Suggested page types ───────────────────────────────────────────────────────

const COMMON_PAGES = [
  { label: 'Homepage',           slug: '/' },
  { label: 'Product / Item page', slug: '/product' },
  { label: 'Category page',      slug: '/category' },
  { label: 'Cart',               slug: '/cart' },
  { label: 'Checkout',           slug: '/checkout' },
  { label: 'Order confirmation', slug: '/order-confirmation' },
  { label: 'Pricing page',       slug: '/pricing' },
  { label: 'Contact / Lead form', slug: '/contact' },
  { label: 'Sign-up page',       slug: '/signup' },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizePageUrl(base: string, input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  // Relative path — append to base URL
  try {
    return new URL(trimmed, base).href;
  } catch {
    return trimmed;
  }
}

function isValidUrl(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function Step2PageDiscovery() {
  const navigate = useNavigate();
  const {
    draftSetup,
    prevStep,
    nextStep,
    setCurrentSession,
    setPages,
    setLoading,
    setError,
    isLoading,
    error,
  } = usePlanningStore();

  const baseUrl = draftSetup.website_url ?? '';

  const [urls, setUrls] = useState<string[]>([baseUrl]);
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');

  // ── Quick-add suggested pages ────────────────────────────────────────────────

  function addSuggested(slug: string) {
    const full = normalizePageUrl(baseUrl, slug);
    if (!full || urls.includes(full) || urls.length >= MAX_PAGES) return;
    setUrls((prev) => [...prev, full]);
  }

  // ── Manual add ───────────────────────────────────────────────────────────────

  function handleAdd() {
    const normalized = normalizePageUrl(baseUrl, inputValue);
    if (!normalized) return;
    if (!isValidUrl(normalized)) {
      setInputError('Enter a valid URL or path (e.g. /checkout or https://…)');
      return;
    }
    if (urls.includes(normalized)) {
      setInputError('This URL is already in the list.');
      return;
    }
    if (urls.length >= MAX_PAGES) {
      setInputError(`Maximum ${MAX_PAGES} pages per session.`);
      return;
    }
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

  // ── Submit — create session + enqueue scan ───────────────────────────────────

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

      // Fetch full session + pages
      const { session, pages } = await planningApi.getSession(session_id);
      setCurrentSession(session);
      setPages(pages);

      // Navigate to /planning/:id — PlanningModePage will route to step 3
      navigate(`/planning/${session_id}`, { replace: true });
      nextStep();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setLoading(false);
    }
  }

  // ── Suggestions not yet added ─────────────────────────────────────────────

  const suggestedNotAdded = COMMON_PAGES.filter(({ slug }) => {
    const full = normalizePageUrl(baseUrl, slug);
    return !urls.includes(full);
  });

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <h2 className="mb-1 text-xl font-bold text-gray-900">Which pages should Atlas scan?</h2>
      <p className="mb-6 text-sm text-gray-500">
        Add up to {MAX_PAGES} pages. Atlas will visit each one and identify what to track.
      </p>

      {/* URL list */}
      <div className="mb-4 space-y-2">
        {urls.map((url) => (
          <div
            key={url}
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2"
          >
            <span className="truncate text-sm text-gray-700">{url}</span>
            {url !== baseUrl ? (
              <button
                onClick={() => removeUrl(url)}
                className="ml-2 flex-shrink-0 text-xs text-gray-400 hover:text-red-500"
                aria-label={`Remove ${url}`}
              >
                ✕
              </button>
            ) : (
              <span className="ml-2 flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-400">
                home
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Manual add input */}
      {urls.length < MAX_PAGES && (
        <div className="mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); setInputError(''); }}
              onKeyDown={handleKeyDown}
              placeholder="/checkout or https://example.com/checkout"
              className={`flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                inputError ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            <button
              onClick={handleAdd}
              disabled={!inputValue.trim()}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {inputError && <p className="mt-1 text-xs text-red-600">{inputError}</p>}
          <p className="mt-1 text-xs text-gray-400">
            {MAX_PAGES - urls.length} page{MAX_PAGES - urls.length !== 1 ? 's' : ''} remaining
          </p>
        </div>
      )}

      {/* Quick-add suggestions */}
      {suggestedNotAdded.length > 0 && urls.length < MAX_PAGES && (
        <div className="mb-8">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
            Common pages — click to add
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestedNotAdded.map(({ label, slug }) => (
              <button
                key={slug}
                onClick={() => addSuggested(slug)}
                className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:border-brand-400 hover:text-brand-700"
              >
                + {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Nav buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={prevStep}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          ← Back
        </button>
        <button
          onClick={handleStart}
          disabled={urls.length === 0 || isLoading}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          {isLoading ? 'Starting scan…' : `Scan ${urls.length} page${urls.length !== 1 ? 's' : ''} →`}
        </button>
      </div>
    </div>
  );
}
