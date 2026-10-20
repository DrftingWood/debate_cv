import { describe, expect, test } from 'vitest';
import { classifyMotion } from '@/lib/motions/classify';

// Every case is a real motion from the 2026-09 corpus unless marked otherwise.
const type = (text: string) => classifyMotion(text).type;

describe('classifyMotion — type from the stem', () => {
  test.each([
    ['THW reinstate the FCC Fairness Doctrine', 'Policy'],
    ['This House Would create seats in Parliament/Congress for immigrants', 'Policy'],
    ['THBT the supranational narratives of Pan-slavic Brotherhood have done more harm than good', 'Belief'],
    ['This House Believes That developed countries should pay reparations', 'Belief'],
    ['THS academic social science research taking explicit normative stances about politics', 'Stance'],
    ['This House opposes the commodification of mindfulness', 'Stance'],
    ['TH regrets the trend of prominent businesswomen giving advice on how to succeed', 'Regret'],
    ['THR the rise of social media influencers in the medical industry.', 'Regret'],
    ['THP a world where all major team sports undergo significant rule changes every five years', 'Preference'],
    ['This House prefers a collegiate model of university governance over a centralised model.', 'Preference'],
  ])('%s → %s', (text, expected) => {
    expect(type(text)).toBe(expected);
  });
});

describe('classifyMotion — actor motions', () => {
  test.each([
    'TH, as the United States, would publicly call for a ceasefire in Ukraine',
    'TH, as the US, W reinstate the FCC Fairness Doctrine',
    'TH, as Myakumyaku W, pursue a romantic relationship with Sama',
    'TH as a developing country during the COVID pandemic would choose to prioritise vaccinating young individuals',
    'This House, as a Heterosexual Woman in a Western Liberal Democracy, Would choose not to have children',
    'As a progressive voter in a swing state, THW vote for the centrist candidate', // constructed
  ])('%s → Actor', (text) => {
    expect(type(text)).toBe('Actor');
  });

  test('"as" later in a policy motion is not actor framing', () => {
    expect(type('THW treat addiction as a public health issue')).toBe('Policy'); // constructed
  });
});

describe('classifyMotion — context-led motions', () => {
  test('a leading setting keeps the stem type and sets the flag', () => {
    const m = classifyMotion(
      'In countries with high rates of immigration, This House Would create seats in Parliament for immigrants',
    );
    expect(m).toMatchObject({ type: 'Policy', contextLed: true });
  });

  test.each([
    ['In parliamentary systems, THBT governments should be formed through a union of parties', 'Belief'],
    ['Assuming feasibility, THP a world where individuals can foresee their future', 'Preference'],
  ])('%s → %s', (text, expected) => {
    expect(classifyMotion(text)).toMatchObject({ type: expected, contextLed: true });
  });

  test('a motion that opens with its stem is not context-led', () => {
    expect(classifyMotion('THW reinstate the FCC Fairness Doctrine').contextLed).toBe(false);
  });
});

describe('classifyMotion — Australs "That …" motions take the type of the verb that follows', () => {
  test.each([
    ['A: That we support the CBAM.', 'Stance'],
    ['C: That labour unions in the tertiary education sector should deprioritise strikes', 'Policy'],
    ['That we, as this young person, would opt into calling out the abuser', 'Actor'],
    ['That we regret the rise of hustle culture', 'Regret'], // constructed
    ['That we prefer a world without organised religion', 'Preference'], // constructed
    ['That the rise of fast fashion has done more harm than good', 'Belief'], // constructed
  ])('%s → %s', (text, expected) => {
    expect(type(text)).toBe(expected);
  });
});

describe('classifyMotion — flags and fallbacks', () => {
  test('an info slide sets the flag; blank or missing does not', () => {
    expect(classifyMotion('THW ban zoos', 'Zoos are…').infoSlide).toBe(true);
    expect(classifyMotion('THW ban zoos', '   ').infoSlide).toBe(false);
    expect(classifyMotion('THW ban zoos', null).infoSlide).toBe(false);
    expect(classifyMotion('THW ban zoos').infoSlide).toBe(false);
  });

  test('text with no recognisable stem is Unclassified, never guessed', () => {
    expect(type('Motion to be announced')).toBe('Unclassified');
    expect(type('')).toBe('Unclassified');
  });

  test('stems are matched case-insensitively and across irregular spacing', () => {
    expect(type('thbt   cities should  ban cars')).toBe('Belief');
    expect(type('  THIS HOUSE WOULD ban cars')).toBe('Policy');
  });
});

// Phrasings the first corpus run missed (97.2 %). All real motions.
describe('classifyMotion — phrasings found by the corpus coverage run', () => {
  test.each([
    ['That, as environmentalists, we would choose a strategy of working closely with corporations.', 'Actor'],
    ['A: That, as the Houthi rebels, we would reject any negotiations with the Presidential Leadership Council', 'Actor'],
    ['B: That, as the Australian Labor Party, we should aggressively compete with China to fund infrastructure', 'Actor'],
    ['That, in countries where military service is mandatory only for men, as self-proclaimed feminist women, we would actively volunteer', 'Actor'],
  ])('Australs actor with a comma after "That": %s', (text, expected) => {
    expect(type(text)).toBe(expected);
  });

  test.each([
    ['TH will mandate a cooling off period of one term for any elected representative', 'Policy'],
    ['This house will abolish the anti-defection law', 'Policy'],
    ['TH, as the German Government, will revoke all rent caps', 'Actor'],
  ])('"will" is a policy stem: %s', (text, expected) => {
    expect(type(text)).toBe(expected);
  });

  test.each([
    'TH(feminist movement)W celebrate the increasing participation of women in the army',
    'Time set (post US election results) TH( Biden administration) will revoke the Trump administrations decision',
  ])('an actor in brackets is an actor: %s', (text) => {
    expect(type(text)).toBe('Actor');
  });

  test.each([
    ['This house welcomes research that seeks to transfer human consciousness into simulations', 'Stance'],
    ['This House welcomes the end of work', 'Stance'],
    ['TH predicts Europe will be more stable in ten years than it is today', 'Belief'],
    ['TH hopes that the USA loses its status as a global superpower.', 'Preference'],
  ])('welcomes / predicts / hopes: %s', (text, expected) => {
    expect(type(text)).toBe(expected);
  });

  test('an aside between subject and verb is not actor framing', () => {
    expect(type('TH, regardless of relationship status, would submit their DNA for OTM')).toBe('Policy');
  });

  test.each([
    ['B: That, where a player of the national team is originally from a different country, nations should be required to pay compensation', 'Policy'],
    ['C: Assuming the technology exists, that it is immoral to create simulated high-fidelity alternate universes.', 'Belief'],
  ])('context inside an Australs motion: %s', (text, expected) => {
    expect(classifyMotion(text)).toMatchObject({ type: expected, contextLed: true });
  });

  test('a sentence with no stem at all stays Unclassified', () => {
    expect(
      type('In the study of the history of Dalits scholars should emphasize the history of their contribution'),
    ).toBe('Unclassified');
  });
});

// Red-team findings, 2026-09. Real motions unless marked constructed; the
// real ones were misses on the csv2 corpus export (1,129 motions).
describe('classifyMotion — invisible characters and quotes around the motion', () => {
  test.each([
    ['‎THR the reinstatement of Manila as the capital city of the Philippines.', 'Regret'],
    ['“THW ban zoos”', 'Policy'], // constructed
    ['"This House would ban zoos"', 'Policy'], // constructed
    ['A: "THW ban zoos"', 'Policy'], // constructed
  ])('%s → %s', (text, expected) => {
    expect(type(text)).toBe(expected);
  });
});

describe('classifyMotion — "as" that is not an actor', () => {
  test.each([
    ['As the world warms, THBT developed nations should accept climate migrants', 'Belief'], // constructed
    ['As the dust settles, THW hold a truth commission', 'Policy'], // constructed
    ['As a result of the war, THW rebuild the energy grid first', 'Policy'], // constructed
    ['This House, as a matter of principle, would refuse to negotiate with terrorists', 'Policy'], // constructed
    ['TH, as a result, would abandon the peace talks', 'Policy'], // constructed
    ['THW, as soon as possible, ban fossil fuel subsidies', 'Policy'], // constructed
    ['TH as of 2025 would abolish tuition fees', 'Policy'], // constructed
  ])('%s → %s', (text, expected) => {
    expect(type(text)).toBe(expected);
  });

  test('a leading context clause still marks the motion context-led', () => {
    expect(classifyMotion('As the world warms, THBT developed nations should accept climate migrants')).toMatchObject({
      type: 'Belief',
      contextLed: true,
    });
  });

  test('a leading actor whose clause holds a relative verb is still an actor', () => {
    expect(
      type(
        'As an average, lower-socio economic class student who lives in a developing country, This House would choose a vocational career as opposed to a career that requires higher education qualification',
      ),
    ).toBe('Actor');
    expect(type('As a person who has lost a child to gun violence, THW campaign for gun control')).toBe('Actor'); // constructed
  });
});

describe('classifyMotion — actor clauses the first pass could not read', () => {
  test.each([
    'THW, as major sporting associations of female dominated sports (e.g. netball, gymnastics, beach volleyball, figure skating), focus our marketing/recruitment on expanding men’s participation',
    'This House would, as the EU, sanction Hungary', // constructed from red-team probe
    "TH, as a heterosexual, highly educated woman, would choose to enter a 'weekend marriage'",
    'TH, as an aging, upper middle class couple, P to give their wealth to their heirs while they are alive as opposed to waiting to distribute it upon their death',
    // A long actor clause: pins that the length cap on (2) leaves room for it.
    'TH, as a POC (Person of Colour) from and in a poorer and underdeveloped area witnessing a non-violent crime (theft, trespassing, drug possession) by another POC, would choose to not call the cops',
  ])('%s → Actor', (text) => {
    expect(type(text)).toBe('Actor');
  });
});

describe('classifyMotion — compact and less common stems', () => {
  test.each([
    ['THPAW where religious beliefs and teachings are not codified into scripture or doctrine.', 'Preference'],
    ['THPAW where the Jamaat-NCP Coalition won a parliamentary majority in the 2026 Bangladesh Elections.', 'Preference'],
    ['THB that international pro-democracy organisations should provide material support to feminist groups', 'Belief'],
    ['THB the mainstream media should have covered the Hunter Biden emails', 'Belief'],
    ['TBHT education systems should heavily prioritise the teaching of local literature over the global canon', 'Belief'],
    ['THC the decline of the Academy Awards', 'Stance'],
    ['TH rejects the idea of a "just war"', 'Stance'],
    ['TH, in a zombie apocalypse W choose to join the authoritarian society over the democracy.', 'Policy'],
  ])('%s → %s', (text, expected) => {
    expect(type(text)).toBe(expected);
  });

  test('a stem glued to a longer word is not a one-letter verb', () => {
    expect(type('This houses would ban zoos')).not.toBe('Stance'); // constructed
    expect(type('This houses would ban zoos')).toBe('Policy');
  });
});

describe('classifyMotion — Australs prefixes beyond A–E', () => {
  test.each([
    ['F: That we should abolish the monarchy', 'Policy'], // constructed
    ['1. That we should abolish the monarchy', 'Policy'], // constructed
    ['Motion: That we should abolish the monarchy', 'Policy'], // constructed
    ['Motion 2: That we regret the rise of hustle culture', 'Regret'], // constructed
  ])('%s → %s', (text, expected) => {
    expect(type(text)).toBe(expected);
  });
});

describe('classifyMotion — context stated as its own sentence', () => {
  test('a context sentence ending in a full stop is context-led', () => {
    expect(
      classifyMotion('Context: In 2024, X elected a populist. THW impeach him.'), // constructed
    ).toMatchObject({ type: 'Policy', contextLed: true });
  });

  test('a round label ending in a colon is not context', () => {
    expect(classifyMotion('Round 1: THW ban zoos').contextLed).toBe(false); // constructed
    expect(classifyMotion('Open Grand Final motion: THW ban zoos').contextLed).toBe(false); // constructed
  });
});
