import { describe, expect, it } from 'vitest';
import { normalizeText, quoteFound, sameQuote, tokens } from '../../shared/normalize';

describe('normalizeText', () => {
  it('makes comma-below, cedilla and plain letters equal', () => {
    expect(normalizeText('Ședința, ţinută ÎN țară!')).toBe('sedinta tinuta in tara');
    expect(normalizeText('Şedinţa')).toBe(normalizeText('Ședința'));
  });
  it('collapses punctuation and whitespace', () => {
    expect(normalizeText("  it's   a formality. ")).toBe('it s a formality');
  });
});

describe('quoteFound', () => {
  const transcript = tokens(
    "Client PM: They're basically final. Legal just needs to sign off, it's a formality. Finance: every customer was happy.",
  );
  it('finds verbatim quotes', () => {
    expect(quoteFound("Legal just needs to sign off, it's a formality.", transcript)).toBe(true);
  });
  it('tolerates small STT/model differences', () => {
    expect(quoteFound('legal just needs to sign it off its a formality', transcript)).toBe(true);
  });
  it('rejects invented quotes', () => {
    expect(quoteFound('we will definitely miss the deadline', transcript)).toBe(false);
    expect(quoteFound('', transcript)).toBe(false);
  });
  it('rejects words that are present but scattered', () => {
    expect(quoteFound('final customer formality happy', transcript)).toBe(false);
  });
  it('matches Romanian with or without diacritics', () => {
    const ro = tokens('Termenul e vineri, semnătura juridică e o formalitate.');
    expect(quoteFound('semnatura juridica e o formalitate', ro)).toBe(true);
  });
});

describe('sameQuote', () => {
  it('treats a shorter excerpt as the same quote', () => {
    expect(sameQuote("it's a formality", "Legal just needs to sign off, it's a formality")).toBe(
      true,
    );
    expect(sameQuote('skip the second test cycle', "it's a formality")).toBe(false);
  });
});

describe('sameQuote with very short quotes', () => {
  it('requires identical text below 3 tokens', () => {
    expect(sameQuote('the date', 'we need to confirm the date with legal')).toBe(false);
    expect(sameQuote('The date.', 'the date')).toBe(true);
  });
});
