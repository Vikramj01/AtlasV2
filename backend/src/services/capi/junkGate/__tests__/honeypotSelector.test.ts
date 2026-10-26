import { describe, it, expect } from 'vitest';
import { sanitiseHoneypotSelector } from '../honeypotSelector';

describe('sanitiseHoneypotSelector', () => {
  it.each(['input[name="website"]', '#hp_field', '.hp-trap', 'form input[name=url_confirm]', 'input[type="text"][name="fax"]', 'div > input.hp'])(
    'accepts the ordinary selector %s', (s) => expect(sanitiseHoneypotSelector(s)).toBe(s));

  it('trims surrounding whitespace', () => expect(sanitiseHoneypotSelector('  #hp  ')).toBe('#hp'));

  it.each([
    ["x');alert(1);//"], ['a`b'], ['a;b'], ['</script>'], ['a\\b'], ['a{b}'], ['a(b)'], ['a\nb'], ['$(document)'],
  ])('rejects script-breaking input %j', (s) => expect(sanitiseHoneypotSelector(s)).toBeNull());

  it('rejects empty, whitespace-only, null, undefined and over-length values', () => {
    for (const v of ['', '   ', null, undefined, 'x'.repeat(101)]) expect(sanitiseHoneypotSelector(v)).toBeNull();
    expect(sanitiseHoneypotSelector('x'.repeat(100))).toBe('x'.repeat(100));
  });
});
