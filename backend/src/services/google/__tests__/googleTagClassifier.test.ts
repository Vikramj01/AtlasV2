import { describe, it, expect } from 'vitest';
import {
  classifyGoogleTag,
  ga4ConfigTagMatch,
  kindFromGoogleId,
  requiredConsentTypesForGoogleTag,
} from '../googleTagClassifier';

const constVar = (name: string, value: string) => ({
  name,
  type: 'c',
  parameter: [{ key: 'value', value }],
});
const tag = (tagId: string | undefined, extra: Record<string, unknown> = {}) => ({
  tagId: '1',
  type: 'googtag',
  parameter: tagId === undefined ? [] : [{ key: 'tagId', value: tagId }],
  ...extra,
});

describe('kindFromGoogleId', () => {
  it.each([
    ['G-ABC123', 'ga4'],
    ['AW-123456', 'google_ads'],
    ['DC-98765', 'floodlight'],
    ['GT-XYZ', 'google_tag'],
    ['UA-1-1', 'unknown'],
    ['aw-123', 'google_ads'],
  ])('%s → %s', (id, kind) => expect(kindFromGoogleId(id)).toBe(kind));
});

describe('classifyGoogleTag', () => {
  it('classifies a literal ID', () => {
    const c = classifyGoogleTag(tag('AW-1'));
    expect(c).toMatchObject({ kind: 'google_ads', resolution: 'literal', resolvedTagId: 'AW-1' });
  });

  it('resolves a {{CONST - …}} constant variable (Atlas generator shape)', () => {
    const container = { variables: [constVar('CONST - GA4 Measurement ID', 'G-TEST')] };
    const c = classifyGoogleTag(tag('{{CONST - GA4 Measurement ID}}'), container);
    expect(c).toMatchObject({ kind: 'ga4', resolution: 'constant_variable', resolvedTagId: 'G-TEST' });
  });

  it('is unresolvable for a non-constant variable', () => {
    const container = { variables: [{ name: 'DLV - id', type: 'v', parameter: [{ key: 'name', value: 'x' }] }] };
    expect(classifyGoogleTag(tag('{{DLV - id}}'), container)).toMatchObject({ kind: 'unknown', resolution: 'unresolvable' });
  });

  it('is unresolvable when the variable is missing or the constant is itself a variable', () => {
    expect(classifyGoogleTag(tag('{{Nope}}'), { variables: [] }).resolution).toBe('unresolvable');
    const container = { variables: [constVar('A', '{{B}}')] };
    expect(classifyGoogleTag(tag('{{A}}'), container).resolution).toBe('unresolvable');
  });

  it('never classifies from the tag name', () => {
    const c = classifyGoogleTag(tag(undefined, { name: 'GA4 - Config' }));
    expect(c.kind).toBe('unknown');
  });

  it('classifies legacy gaawc as ga4 without resolution', () => {
    expect(classifyGoogleTag({ tagId: '2', type: 'gaawc', parameter: [] }).kind).toBe('ga4');
  });
});

describe('ga4ConfigTagMatch', () => {
  it('matches gaawc and a G- googtag definitely', () => {
    expect(ga4ConfigTagMatch({ type: 'gaawc' })).toEqual({ match: true, definite: true });
    expect(ga4ConfigTagMatch(tag('G-1'))).toEqual({ match: true, definite: true });
  });
  it('excludes AW- and DC- googtags', () => {
    expect(ga4ConfigTagMatch(tag('AW-1')).match).toBe(false);
    expect(ga4ConfigTagMatch(tag('DC-1')).match).toBe(false);
  });
  it('includes unknown and GT- googtags as non-definite', () => {
    expect(ga4ConfigTagMatch(tag(undefined))).toEqual({ match: true, definite: false });
    expect(ga4ConfigTagMatch(tag('GT-1'))).toEqual({ match: true, definite: false });
  });
  it('ignores other tag types', () => {
    expect(ga4ConfigTagMatch({ type: 'awct' }).match).toBe(false);
  });
});

describe('requiredConsentTypesForGoogleTag', () => {
  it('maps kinds to consent types', () => {
    expect(requiredConsentTypesForGoogleTag('ga4')).toEqual({ types: ['analytics_storage'], definite: true });
    expect(requiredConsentTypesForGoogleTag('google_ads').types).toEqual(['ad_storage', 'ad_user_data']);
    expect(requiredConsentTypesForGoogleTag('unknown')).toMatchObject({ definite: false });
    expect(requiredConsentTypesForGoogleTag('unknown').types).toEqual(
      expect.arrayContaining(['analytics_storage', 'ad_storage', 'ad_user_data']),
    );
  });
});
