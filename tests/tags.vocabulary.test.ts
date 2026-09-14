import { describe, expect, test } from 'vitest';
import {
  inferMotionType,
  TAG_VALUES,
  MOTION_TYPES,
  MOTION_TOPICS,
  REGIONS,
} from '@/lib/tags/vocabulary';

describe('inferMotionType', () => {
  test('detects spelled-out stems', () => {
    expect(inferMotionType('This House would ban private schools')).toBe('THW');
    expect(inferMotionType('This House believes that states should...')).toBe('THBT');
    expect(inferMotionType('This House believes social media has...')).toBe('THBT');
    expect(inferMotionType('This House opposes the gig economy')).toBe('THO');
    expect(inferMotionType('This House prefers a world where...')).toBe('THP');
    expect(inferMotionType('This House regrets the rise of...')).toBe('THR');
    expect(inferMotionType('This House supports degrowth')).toBe('THS');
  });

  test('detects abbreviated stems, case-insensitive', () => {
    expect(inferMotionType('THW ban private schools')).toBe('THW');
    expect(inferMotionType('thbt the West should...')).toBe('THBT');
    expect(inferMotionType('THO. the glorification of hustle culture')).toBe('THO');
  });

  test('unusual This-House stems fall back to Other', () => {
    expect(inferMotionType('This House, as the EU, would federalize')).toBe('Other');
  });

  test('non-motion text returns null rather than guessing', () => {
    expect(inferMotionType('Round 1 motion TBA')).toBeNull();
    expect(inferMotionType('')).toBeNull();
  });
});

describe('vocabulary integrity', () => {
  test('TAG_VALUES maps every kind to its list', () => {
    expect(TAG_VALUES.region).toBe(REGIONS);
    expect(TAG_VALUES.motion_type).toBe(MOTION_TYPES);
    expect(TAG_VALUES.motion_topic).toBe(MOTION_TOPICS);
  });

  test('no duplicate values within a list', () => {
    for (const list of [REGIONS, MOTION_TYPES, MOTION_TOPICS]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});
