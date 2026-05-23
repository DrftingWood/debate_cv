import { describe, it, expect } from 'vitest';
import { volumeRoman } from '@/lib/cv/volumeRoman';

describe('volumeRoman', () => {
  it('returns "I" for null activeYears (no tournaments yet)', () => {
    expect(volumeRoman(null)).toBe('I');
  });

  it('returns "I" for a one-year span', () => {
    expect(volumeRoman({ from: 2024, to: 2024 })).toBe('I');
  });

  it('returns "III" for a three-year span', () => {
    expect(volumeRoman({ from: 2022, to: 2024 })).toBe('III');
  });

  it('returns "VIII" for an eight-year span', () => {
    expect(volumeRoman({ from: 2017, to: 2024 })).toBe('VIII');
  });

  it('returns "IX" for exactly a nine-year span', () => {
    expect(volumeRoman({ from: 2016, to: 2024 })).toBe('IX');
  });

  it('caps at "IX+" for spans of 10 years or more', () => {
    expect(volumeRoman({ from: 2010, to: 2024 })).toBe('IX+');
    expect(volumeRoman({ from: 2000, to: 2024 })).toBe('IX+');
  });

  it('handles reversed/invalid spans defensively (returns "I")', () => {
    expect(volumeRoman({ from: 2024, to: 2022 })).toBe('I');
  });
});
