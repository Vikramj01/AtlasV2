/** IdentityConfigStep — honeypot inputs (junk gate follow-up to C3). Plain DOM assertions. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IdentityConfigStep } from './IdentityConfigStep';
import type { ClientIdentityConfig } from '@/types/enrichment';

const onSave = vi.fn().mockResolvedValue(undefined);

const initial = (over: Partial<ClientIdentityConfig> = {}): ClientIdentityConfig => ({
  id: 'i1', client_id: 'c1', email_field: 'customer.email', phone_field: null, first_name_field: null, last_name_field: null,
  postal_code_field: null, country_field: null, external_id_field: null, fbc_field: '_fbc', fbp_field: '_fbp', gclid_field: 'gclid',
  wbraid_field: 'wbraid', gbraid_field: 'gbraid', ttclid_field: 'ttclid', oppref_field: 'oppref',
  auto_capture_ip: true, auto_capture_ua: true, enabled_identifiers: ['email'], validated_at: null, identity_score: null,
  created_at: '', updated_at: '', ...over,
} as ClientIdentityConfig);

const renderStep = (cfg: ClientIdentityConfig | null = null) =>
  render(<IdentityConfigStep clientId="c1" initialConfig={cfg} onSave={onSave} mode="standalone" />);
const selectorInput = () => screen.getByPlaceholderText('input[name="website"]') as HTMLInputElement;
const pathInput = () => screen.getByPlaceholderText('form.website') as HTMLInputElement;
const save = () => fireEvent.click(screen.getByText('Save changes'));

beforeEach(() => { vi.clearAllMocks(); });

describe('IdentityConfigStep — honeypot', () => {
  it('shows the stored selector and data path', () => {
    renderStep(initial({ honeypot_selector: '#hp', honeypot_field: 'form.url' }));
    expect(selectorInput().value).toBe('#hp');
    expect(pathInput().value).toBe('form.url');
  });

  it('saves a valid selector and path (trimmed)', async () => {
    renderStep(initial());
    fireEvent.change(selectorInput(), { target: { value: '  input[name="website"] ' } });
    fireEvent.change(pathInput(), { target: { value: ' form.website ' } });
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ honeypot_selector: 'input[name="website"]', honeypot_field: 'form.website' });
  });

  it('blank values are sent as null so they clear a stored value', async () => {
    renderStep(initial({ honeypot_selector: '#hp', honeypot_field: 'form.url' }));
    fireEvent.change(selectorInput(), { target: { value: '' } });
    fireEvent.change(pathInput(), { target: { value: '   ' } });
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ honeypot_selector: null, honeypot_field: null });
  });

  it.each([["x');alert(1);//"], ['</script>'], ['a`b']])('blocks an unsafe selector %j client-side and does not call onSave', async (v) => {
    renderStep(initial());
    fireEvent.change(selectorInput(), { target: { value: v } });
    save();
    await waitFor(() => expect(screen.getByText(/Honeypot selector can only contain/)).toBeTruthy());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('says plainly that only filled/not-filled is recorded and nothing is added to the form', () => {
    renderStep(initial());
    expect(screen.getByText(/Atlas never adds a field to your form/)).toBeTruthy();
    expect(screen.getByText(/never what was typed/)).toBeTruthy();
  });
});
