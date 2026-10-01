import { describe, it, expect, vi } from 'vitest';

vi.mock('@/services/browserbase/client', () => ({ createBrowserbaseSession: vi.fn(), getCDPUrl: vi.fn() }));

import { detectSignalsOnPage } from '../signalDetector';

const page = { evaluate: async () => [] } as unknown as Parameters<typeof detectSignalsOnPage>[0];
const req = (url: string) => ({ url, postData: null });

describe('CSE google_tag_destination_observed signals', () => {
  it('records attributed and unattributable destinations separately', async () => {
    const signals = await detectSignalsOnPage(page, [
      req('https://www.googletagmanager.com/gtag/js?id=G-ABC'),
      req('https://region1.google-analytics.com/g/collect?v=2&tid=G-ABC'),
      req('https://www.googleadservices.com/pagead/conversion/111111/?label=x'),
    ]);
    const dest = signals.filter((s) => s.signal_type === 'google_tag_destination_observed');
    expect(dest).toHaveLength(2);
    expect(dest.find((s) => s.signal_id === 'G-ABC')).toMatchObject({ signal_name: 'G-ABC', parameters: { attributed: true } });
    expect(dest.find((s) => s.signal_id === 'AW-111111')).toMatchObject({ signal_name: null, parameters: { attributed: false, loaded_tag_id: null } });
  });

  it('emits nothing when no Google destination was hit', async () => {
    const signals = await detectSignalsOnPage(page, [req('https://example.com/x')]);
    expect(signals.some((s) => s.signal_type === 'google_tag_destination_observed')).toBe(false);
  });
});
