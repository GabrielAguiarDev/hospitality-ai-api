import type { RequestDepartment } from '../resort/requests-catalog.service.js';

import { matchItems, mentionedDepartment, requestTokens, stem, symptomDepartment } from './request-matching.js';

const department = (id: string, name: string, items: string[]): RequestDepartment => ({
  id,
  name,
  description: null,
  items: items.map((item, index) => ({ id: `${id}${index}`, name: item })),
  info: [],
});

const GOVERNANCA = department('3', 'Governança', ['Toalha de banho', 'Travesseiro', 'Lençol', 'Cobertor', 'Kit Pet']);
const MANUTENCAO = department('5', 'Manutenção', ['Ar condicionado', 'Chuveiro', 'Lâmpada', 'TV']);
const TI = department('7', 'TI', ['Wi-Fi', 'Canais de TV']);
const DEPARTMENTS = [GOVERNANCA, MANUTENCAO, TI];

const names = (message: string, departments = DEPARTMENTS) => matchItems(message, departments).map(({ item }) => item.name);

describe('stem', () => {
  it.each([
    ['toalhas', 'toalha'],
    ['travesseiros', 'travesseiro'],
    ['lencois', 'lencol'],
    ['cobertores', 'cobertor'],
    ['paes', 'pao'],
    ['botoes', 'botao'],
    ['animais', 'animal'],
    ['papeis', 'papel'],
    ['lampadas', 'lampada'],
    ['bens', 'bem'],
    ['luzes', 'luz'],
  ])('%s -> %s', (plural, singular) => {
    expect(stem(plural)).toBe(singular);
  });

  it('keeps short words and words ending in "ss"', () => {
    expect(stem('tvs')).toBe('tvs');
    expect(stem('ar')).toBe('ar');
    expect(stem('acess')).toBe('acess');
  });

  it('is idempotent on singular forms', () => {
    expect(stem('toalha')).toBe('toalha');
    expect(stem('travesseiro')).toBe('travesseiro');
  });
});

describe('requestTokens', () => {
  it('drops stopwords, digits and one-letter words, and stems', () => {
    expect(requestTokens('Quero 2 toalhas de banho para o quarto')).toEqual(['quero', 'toalha', 'banho']);
  });

  it('joins "wi fi" into one token', () => {
    expect(requestTokens('o Wi-Fi não conecta')).toContain('wifi');
  });
});

describe('matchItems', () => {
  it.each([
    ['Preciso de toalhas', 'Toalha de banho'],
    ['preciso de lençóis', 'Lençol'],
    ['mais travesseiros, por favor', 'Travesseiro'],
    ['Obrigado, me traga um travesseiro extra', 'Travesseiro'],
    ['Quero um kit pet', 'Kit Pet'],
  ])('finds the catalog item for "%s"', (message, item) => {
    expect(names(message)).toEqual([item]);
  });

  it('picks the exact item "TV" over "Canais de TV" when both exist', () => {
    // "TV" tem melhor cobertura que "Canais de TV" e está só na Manutenção.
    const matches = matchItems('a TV não liga', DEPARTMENTS);

    expect(matches.map(({ item, department }) => [item.name, department.name])).toEqual([['TV', 'Manutenção']]);
  });

  it('returns items tied across departments, so the handler can ask which one', () => {
    const tied = [department('5', 'Manutenção', ['TV']), department('7', 'TI', ['TV'])];

    expect(matchItems('a TV não liga', tied).map(({ department: { name } }) => name).sort()).toEqual(['Manutenção', 'TI']);
  });

  it('returns several different items mentioned together', () => {
    expect(names('Preciso de toalhas e travesseiros').sort()).toEqual(['Toalha de banho', 'Travesseiro']);
  });

  it('returns nothing for words that are not in the catalog', () => {
    expect(names('Preciso de um helicóptero')).toEqual([]);
    expect(names('Obrigado!')).toEqual([]);
    expect(names('')).toEqual([]);
  });

  it('does not match stopword-only overlaps such as "de" or "para"', () => {
    expect(names('para de')).toEqual([]);
  });

  it('never invents an item: results are always catalog entries', () => {
    const catalogNames = new Set(DEPARTMENTS.flatMap(({ items }) => items.map(({ name }) => name)));

    for (const message of ['toalhas', 'tv', 'wifi', 'chuveiro quebrado', 'ar condicionado']) {
      for (const { item } of matchItems(message, DEPARTMENTS)) expect(catalogNames.has(item.name)).toBe(true);
    }
  });

  describe('quantities', () => {
    it.each([
      ['Preciso de toalhas', 1],
      ['2 toalhas', 2],
      ['Preciso de 3 toalhas', 3],
      ['duas toalhas', 2],
      ['Quero dois travesseiros', 2],
      ['mais 2 toalhas de banho', 2],
      ['dez toalhas', 10],
    ])('"%s" -> %i', (message, quantity) => {
      expect(matchItems(message, DEPARTMENTS)[0].quantity).toBe(quantity);
    });

    it('caps the quantity at 10 and never goes below 1', () => {
      expect(matchItems('50 toalhas', DEPARTMENTS)[0].quantity).toBe(10);
      expect(matchItems('0 toalhas', DEPARTMENTS)[0].quantity).toBe(1);
    });

    it('does not read a number elsewhere in the text as the quantity', () => {
      expect(matchItems('Quarto 12 precisa de toalhas', DEPARTMENTS)[0].quantity).toBe(1);
    });
  });
});

describe('matchItems - ties and span quantities', () => {
  const towels = department('3', 'Governança', ['Toalha de banho', 'Toalha de rosto', 'Travesseiro']);

  it('flags items tied on the same words ("toalha") so the handler can ask which one', () => {
    const matches = matchItems('Preciso de toalhas', [towels]);

    expect(matches.map(({ item }) => item.name).sort()).toEqual(['Toalha de banho', 'Toalha de rosto']);
    expect(matches.every(({ tied }) => tied)).toBe(true);
  });

  it('does not flag a unique match', () => {
    const [match] = matchItems('Preciso de travesseiros', [towels]);

    expect(match.tied).toBe(false);
  });

  it('disambiguates when the message names the full item', () => {
    const matches = matchItems('Preciso de toalha de rosto', [towels]);

    expect(matches.map(({ item }) => item.name)).toEqual(['Toalha de rosto']);
    expect(matches[0].tied).toBe(false);
  });

  it('gives each item its own quantity from the number that precedes its words', () => {
    const matches = matchItems('2 toalhas de banho e 1 toalha de rosto', [towels]);
    const byName = Object.fromEntries(matches.map(({ item, quantity }) => [item.name, quantity]));

    expect(byName).toEqual({ 'Toalha de banho': 2, 'Toalha de rosto': 1 });
  });

  it('keeps the quantity of a single item with words after it', () => {
    expect(matchItems('duas toalhas de banho', [towels])[0].quantity).toBe(2);
  });
});

describe('mentionedDepartment', () => {
  it.each([
    ['Quero fazer uma solicitação de mais toalhas para a governança.', 'Governança'],
    ['Governança', 'Governança'],
    ['preciso da MANUTENÇÃO', 'Manutenção'],
    ['falar com a ti', 'TI'],
  ])('finds the department in "%s"', (message, name) => {
    expect(mentionedDepartment(message, DEPARTMENTS)?.name).toBe(name);
  });

  it('matches whole words only', () => {
    expect(mentionedDepartment('o motivo da tiara', DEPARTMENTS)).toBeUndefined();
    expect(mentionedDepartment('Preciso de toalhas', DEPARTMENTS)).toBeUndefined();
  });

  it('matches the first word of a long department name', () => {
    const catalog = [department('1', 'Guest Experience', []), department('2', 'Recepção principal', [])];

    expect(mentionedDepartment('falar com a recepção', catalog)?.name).toBe('Recepção principal');
  });
});

describe('symptomDepartment', () => {
  it.each([
    ['o ar condicionado não gela', 'Manutenção'],
    ['a luz queimou, está queimada', 'Manutenção'],
    ['o chuveiro não esquenta', 'Manutenção'],
    ['vazando água no banheiro', 'Manutenção'],
    ['a internet está sem sinal', 'TI'],
    ['o wifi não conecta', 'TI'],
    ['o Wi-Fi caiu, sem conexão', 'TI'],
  ])('"%s" -> %s', (message, name) => {
    expect(symptomDepartment(message, DEPARTMENTS)?.name).toBe(name);
  });

  it('gives IT priority over maintenance when both cues appear', () => {
    expect(symptomDepartment('o wifi não funciona', DEPARTMENTS)?.name).toBe('TI');
  });

  it('is undefined without a symptom or without the department in the catalog', () => {
    expect(symptomDepartment('Preciso de toalhas', DEPARTMENTS)).toBeUndefined();
    expect(symptomDepartment('o chuveiro não esquenta', [GOVERNANCA, TI])).toBeUndefined();
    expect(symptomDepartment('o wifi não conecta', [GOVERNANCA, MANUTENCAO])).toBeUndefined();
  });
});
