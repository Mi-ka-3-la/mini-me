import { describe, expect, it } from 'vitest';
import { parseManual } from '../../src/lib/parseManual';

describe('parseManual', () => {
  it('keeps speakers from "Name: text" lines', () => {
    expect(
      parseManual('Client PM: We go live on the 15th.\nDev lead: If tax rules are frozen.'),
    ).toEqual([
      { speaker: 'Client PM', text: 'We go live on the 15th.' },
      { speaker: 'Dev lead', text: 'If tax rules are frozen.' },
    ]);
  });
  it('accepts Romanian names with comma-below letters', () => {
    expect(parseManual('Ștefan Țurcanu: Facem asta mâine.')).toEqual([
      { speaker: 'Ștefan Țurcanu', text: 'Facem asta mâine.' },
    ]);
  });
  it('leaves lines without a speaker, times and URLs as plain text', () => {
    expect(parseManual('just a note\n10:30 we start\nsee https://example.com')).toEqual([
      { text: 'just a note' },
      { text: '10:30 we start' },
      { text: 'see https://example.com' },
    ]);
  });
  it('skips blank lines and trims', () => {
    expect(parseManual('\n\n  a  \n\n')).toEqual([{ text: 'a' }]);
  });
});
