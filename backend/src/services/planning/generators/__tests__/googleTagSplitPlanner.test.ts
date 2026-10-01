import { describe, it, expect } from 'vitest';
import { planGoogleTagSplit, SPLIT_TRIGGER_NAME } from '../googleTagSplitPlanner';
import { generateGTMContainer } from '../gtmContainerGenerator';
import { validateGTMContainer } from '../gtmSchemaValidator';
import { classifyGoogleTag } from '../../../google/googleTagClassifier';
import type { GTMContainerSnapshot, GTMTag, GTMTrigger, GTMVariable } from '@/types/audit';

const allPages: GTMTrigger = { triggerId: '1', name: 'All Pages', type: 'PAGEVIEW' };
const googtag = (id: string, name: string, extra: Partial<GTMTag> = {}): GTMTag => ({
  tagId: name, name, type: 'googtag', firingTriggerId: ['1'],
  parameter: [{ type: 'TEMPLATE', key: 'tagId', value: id }], ...extra,
});
const constVar = (name: string, value: string): GTMVariable => ({
  variableId: name, name, type: 'c', parameter: [{ type: 'TEMPLATE', key: 'value', value }],
});
const container = (tags: GTMTag[], variables: GTMVariable[] = [], triggers: GTMTrigger[] = [allPages]): GTMContainerSnapshot => ({
  container_id: 'c', fetched_at: '', source: 'gtm_api', tags, triggers, variables, built_in_variables: [], consent_default_tag: null,
});
const conv: GTMTag = { tagId: 'conv', name: 'Ads conv', type: 'awct', firingTriggerId: ['1'], parameter: [] };

describe('planGoogleTagSplit', () => {
  it('adds an Ads Google tag + CONST variable + one trigger for a GA4-only googtag with an Ads conversion tag', () => {
    const c = container([googtag('G-1', 'GA4 tag'), conv], [constVar('Ads ID', 'AW-111')]);
    const plan = planGoogleTagSplit({ container: c });
    expect(plan.conflicts).toEqual([]);
    expect(plan.diff.tags_added).toContain('Google Tag - Google Ads');
    expect(plan.diff.tags_added).not.toContain('GA4 - Config'); // GA4 already covered
    expect(plan.diff.variables_added).toEqual(['CONST - Google Ads Conversion ID']);
    expect(plan.diff.triggers_added).toEqual([SPLIT_TRIGGER_NAME]);
    const ads = plan.delta!.containerVersion.tag.find((t) => t.name === 'Google Tag - Google Ads')!;
    const vars = plan.delta!.containerVersion.variable;
    expect(classifyGoogleTag(ads, { variables: vars }).kind).toBe('google_ads');
    expect(ads.firingTriggerId).toEqual([plan.delta!.containerVersion.trigger[0].triggerId]);
  });

  it('AW-primary combined tag: adds a GA4 Google tag too when GA4 has no tag of its own', () => {
    const c = container([googtag('AW-111', 'Ads tag')]);
    const plan = planGoogleTagSplit({
      container: c,
      topology: { combined_tags: [{ google_tag_id: 'AW-111', primary_destination_id: 'AW-111', destination_ids: ['AW-111', 'G-9'] }] },
    });
    expect(plan.conflicts).toEqual([]);
    expect(plan.diff.tags_added).toContain('GA4 - Config');
    expect(plan.diff.tags_added).not.toContain('Google Tag - Google Ads');
    expect(plan.destinations).toEqual({ ga4: 'G-9', google_ads: 'AW-111' });
  });

  it('keeps a Conversion Linker for cross-domain clients (and adds none when one exists)', () => {
    const c = container([googtag('G-1', 'GA4 tag'), conv], [constVar('Ads ID', 'AW-111')]);
    expect(planGoogleTagSplit({ container: c, secondaryDomains: ['x.com'] }).diff.tags_added).toContain('Google Ads - Conversion Linker');
    const withLinker = container(
      [googtag('G-1', 'GA4 tag'), conv, { tagId: 'l', name: 'My linker', type: 'gclidw', firingTriggerId: ['1'], parameter: [] }],
      [constVar('Ads ID', 'AW-111')],
    );
    expect(planGoogleTagSplit({ container: withLinker, secondaryDomains: ['x.com'] }).diff.tags_added).not.toContain('Google Ads - Conversion Linker');
  });

  it('skips the linker in the single-domain case (Ads Google tag covers click-ID capture)', () => {
    const c = container([googtag('G-1', 'GA4 tag'), conv], [constVar('Ads ID', 'AW-111')]);
    expect(planGoogleTagSplit({ container: c }).diff.tags_added).not.toContain('Google Ads - Conversion Linker');
  });

  it('returns no delta when every destination already has a sitewide Google tag', () => {
    const c = container([googtag('G-1', 'GA4 tag'), googtag('AW-111', 'Ads tag'), conv]);
    const plan = planGoogleTagSplit({ container: c });
    expect(plan.delta).toBeNull();
    expect(plan.conflicts).toEqual([]);
    expect(plan.diff.already_covered.length).toBeGreaterThan(0);
  });

  it('conflict: an existing Google tag for the ID that is not sitewide', () => {
    const c = container(
      [googtag('AW-111', 'Ads tag', { firingTriggerId: ['2'] }), conv],
      [],
      [allPages, { triggerId: '2', name: 'Click', type: 'CLICK', filter: [{ type: 'EQUALS', parameter: [] }] }],
    );
    const plan = planGoogleTagSplit({ container: c });
    expect(plan.delta).toBeNull();
    expect(plan.conflicts[0].code).toBe('existing_not_sitewide');
  });

  it('conflict: a same-name tag, a same-name variable with a different value, and a same-name trigger', () => {
    const base = [googtag('G-1', 'GA4 tag'), conv];
    const sameNameTag: GTMTag = { tagId: 'x', name: 'Google Tag - Google Ads', type: 'html', firingTriggerId: ['1'], parameter: [] };
    expect(planGoogleTagSplit({ container: container([...base, sameNameTag], [constVar('Ads ID', 'AW-111')]) }).conflicts[0].code).toBe('name_conflict');
    expect(
      planGoogleTagSplit({ container: container(base, [constVar('Ads ID', 'AW-111'), constVar('CONST - Google Ads Conversion ID', 'AW-222')]) }).conflicts.length,
    ).toBeGreaterThan(0);
    expect(
      planGoogleTagSplit({
        container: container(base, [constVar('Ads ID', 'AW-111')], [allPages, { triggerId: '7', name: SPLIT_TRIGGER_NAME, type: 'PAGEVIEW' }]),
      }).conflicts[0].code,
    ).toBe('name_conflict');
  });

  it('reuses an existing identical CONST variable instead of conflicting', () => {
    const c = container([googtag('G-1', 'GA4 tag'), conv], [constVar('CONST - Google Ads Conversion ID', 'AW-111')]);
    const plan = planGoogleTagSplit({ container: c });
    expect(plan.conflicts).toEqual([]);
    expect(plan.diff.variables_added).toEqual([]);
    expect(plan.diff.already_covered.join(' ')).toContain('already exists');
  });

  it('conflict: several distinct IDs of one kind', () => {
    const c = container([googtag('G-1', 'a'), googtag('G-2', 'b'), conv], [constVar('Ads ID', 'AW-111')]);
    expect(planGoogleTagSplit({ container: c }).conflicts[0].code).toBe('multiple_destinations');
  });

  it('AC 11: never deletes or modifies existing objects, and the delta validates', () => {
    const c = container([googtag('G-1', 'GA4 tag'), conv], [constVar('Ads ID', 'AW-111')]);
    const before = JSON.stringify(c);
    const plan = planGoogleTagSplit({ container: c });
    expect(JSON.stringify(c)).toBe(before);
    const existingNames = new Set([...c.tags.map((t) => t.name), ...c.variables.map((v) => v.name), ...c.triggers.map((t) => t.name)]);
    const cv = plan.delta!.containerVersion;
    for (const o of [...cv.tag, ...cv.variable, ...cv.trigger]) expect(existingNames.has(o.name)).toBe(false);
    expect(validateGTMContainer(plan.delta).errors).toEqual([]);
  });

  it('equivalence with the generator: the added Ads tag matches what generateGTMContainer emits', () => {
    const generated = generateGTMContainer(
      [],
      { business_type: 'lead_gen', selected_platforms: ['ga4', 'google_ads'] } as never,
      { ga4: 'G-1', google_ads: 'AW-111' },
    );
    const genAds = generated.containerVersion.tag.find((t) => t.name === 'Google Tag - Google Ads')!;
    const plan = planGoogleTagSplit({ container: container([googtag('G-1', 'GA4 tag'), conv], [constVar('Ads ID', 'AW-111')]) });
    const planAds = plan.delta!.containerVersion.tag.find((t) => t.name === 'Google Tag - Google Ads')!;
    expect(planAds.type).toBe(genAds.type);
    expect(planAds.parameter).toEqual(genAds.parameter);
    expect(planAds.consentSettings).toEqual(genAds.consentSettings);
  });

  it('returns no delta and no conflict when the container shows no Google destinations', () => {
    const plan = planGoogleTagSplit({ container: container([]) });
    expect(plan.delta).toBeNull();
    expect(plan.conflicts).toEqual([]);
  });
});
