import { describe, expect, it } from 'vitest';

import {
  extractDate,
  extractEntities,
  extractOrdinal,
  extractParty,
  extractPeriod,
  extractSearchCues,
  extractTime,
  extractTimeRange,
} from './message-entities.js';

// 2026-10-23 is a Friday.
const TODAY = '2026-10-23';

describe('extractDate', () => {
  it.each([
    ['hoje', '2026-10-23'],
    ['amanhã', '2026-10-24'],
    ['depois de amanhã', '2026-10-25'],
    ['sábado', '2026-10-24'],
    ['na segunda', '2026-10-26'],
    ['segunda-feira', '2026-10-26'],
    ['sexta-feira', '2026-10-23'],
    ['domingo', '2026-10-25'],
    ['25/10', '2026-10-25'],
    ['25/10/2026', '2026-10-25'],
    ['25/10/27', '2027-10-25'],
    ['dia 25', '2026-10-25'],
  ])('%s -> %s', (text, expected) => {
    expect(extractDate(text, TODAY)).toBe(expected);
  });

  it('rolls a past dd/mm to the next year but keeps explicit past years', () => {
    expect(extractDate('10/10', TODAY)).toBe('2027-10-10');
    expect(extractDate('10/10/2026', TODAY)).toBe('2026-10-10');
  });

  it('rolls a past "dia N" to next month', () => {
    expect(extractDate('dia 5', TODAY)).toBe('2026-11-05');
  });

  it('rejects invalid dates', () => {
    expect(extractDate('31/02', TODAY)).toBeUndefined();
    expect(extractDate('30/13/2026', TODAY)).toBeUndefined();
  });

  it('does not treat a bare weekday word as a date', () => {
    expect(extractDate('Gostei da segunda.', TODAY)).toBeUndefined();
    expect(extractDate('quero reservar', TODAY)).toBeUndefined();
  });
});

describe('extractTime', () => {
  it.each([
    ['às 10h', '10:00'],
    ['10:30', '10:30'],
    ['10h30', '10:30'],
    ['15 horas', '15:00'],
    ['as 9', '09:00'],
  ])('%s -> %s', (text, expected) => {
    expect(extractTime(text)).toBe(expected);
  });

  it('does not read party sizes as times', () => {
    expect(extractTime('pra 2 pessoas')).toBeUndefined();
    expect(extractTime('quero a 2')).toBeUndefined();
    expect(extractTime('às 2 adultos')).toBeUndefined();
  });

  it('rejects out of range times', () => {
    expect(extractTime('25h')).toBeUndefined();
    expect(extractTime('10:75')).toBeUndefined();
  });
});

describe('extractParty', () => {
  it('reads total people', () => {
    expect(extractParty('duas pessoas')).toEqual({ people: 2 });
    expect(extractParty('3 pessoas')).toEqual({ people: 3 });
  });

  it('reads adults and children', () => {
    expect(extractParty('2 adultos e 1 criança')).toEqual({ adults: 2, children: 1 });
    expect(extractParty('dois adultos e duas crianças')).toEqual({ adults: 2, children: 2 });
  });

  it('does not set people when adults/children are given', () => {
    expect(extractParty('2 adultos, 3 pessoas')).toEqual({ adults: 2 });
  });

  it('reads couple and alone', () => {
    expect(extractParty('um casal')).toEqual({ adults: 2 });
    expect(extractParty('só eu')).toEqual({ adults: 1 });
  });

  it('returns nothing for unrelated text', () => {
    expect(extractParty('boa tarde')).toEqual({});
  });
});

describe('extractOrdinal', () => {
  it.each([
    ['a primeira', 1],
    ['opção 3', 3],
    ['a última', -1],
    ['Gostei da segunda.', 2],
    ['2', 2],
  ])('%s -> %s', (text, expected) => {
    expect(extractOrdinal(text)).toBe(expected);
  });

  it('does not treat "segunda-feira" as an ordinal', () => {
    expect(extractOrdinal('na segunda-feira')).toBeUndefined();
  });
});

describe('extractEntities', () => {
  it('"Gostei da segunda." yields ordinal 2 and no date', () => {
    expect(extractEntities('Gostei da segunda.', TODAY)).toEqual({ ordinal: 2 });
  });

  it('"na segunda" yields the date', () => {
    // Note: ordinal is also reported for "na segunda" (ambiguous by design);
    // the date must be resolved.
    expect(extractEntities('na segunda', TODAY).date).toBe('2026-10-26');
  });

  it('"segunda-feira" yields the date', () => {
    expect(extractEntities('segunda-feira', TODAY).date).toBe('2026-10-26');
  });

  it('combines date, time and party', () => {
    expect(extractEntities('amanhã às 10h para 2 adultos e 1 criança', TODAY)).toEqual({
      date: '2026-10-24',
      time: '10:00',
      adults: 2,
      children: 1,
    });
  });

  it('omits undefined keys', () => {
    expect(extractEntities('olá', TODAY)).toEqual({});
  });

  it('"pra 2 pessoas" gives people and no time', () => {
    expect(extractEntities('pra 2 pessoas', TODAY)).toEqual({ people: 2 });
  });
});

describe('weekday versus ordinal', () => {
  it('treats "na segunda" as a weekday, never as a list position', () => {
    expect(extractEntities('Tem na segunda?', '2026-10-23')).toEqual({ date: '2026-10-26' });
  });
});

describe('extractPeriod', () => {
  it.each([
    ['amanhã de manhã', 'morning'],
    ['E de manhã?', 'morning'],
    ['pela manhã', 'morning'],
    ['E à tarde?', 'afternoon'],
    ['hoje à noite', 'evening'],
  ])('%s -> %s', (text, expected) => {
    expect(extractPeriod(text)).toBe(expected);
  });

  it.each(['Vou chegar tarde, tem problema?', 'Tarde demais?', 'amanhã', 'Boa tarde!', 'Boa noite, Yago', 'Bom dia', 'Qual o horário do café da manhã?', 'falo mais tarde'])(
    'finds no period in %j',
    (text) => {
      expect(extractPeriod(text)).toBeUndefined();
    },
  );
});

describe('extractTimeRange', () => {
  it.each<[string, Record<string, string>]>([
    ['depois das 15h', { after: '15:00' }],
    ['a partir das 14:30', { after: '14:30' }],
    ['após as 9h', { after: '09:00' }],
    ['antes das 10h', { before: '10:00' }],
    ['depois das 14h e antes das 17h', { after: '14:00', before: '17:00' }],
    ['depois das 8 da noite', { after: '20:00' }],
    ['antes das 4 da tarde', { before: '16:00' }],
    // Idade não é horário.
    ['para crianças a partir dos 5 anos', {}],
    ['depois de amanhã', {}],
    ['às 15h', {}],
  ])('%s -> %j', (text, expected) => {
    expect(extractTimeRange(text)).toEqual(expected);
  });
});

describe('extractSearchCues', () => {
  it.each<[string, Record<string, boolean>]>([
    ['Quais são gratuitas?', { free: true }],
    ['Tem alguma para crianças?', { forChildren: true }],
    ['Tem algo infantil?', { forChildren: true }],
    ['Qual tem reserva pra amanhã?', { bookable: true }],
    ['Quais posso reservar de manhã?', { bookable: true }],
    ['Quais têm vagas amanhã?', { bookable: true }],
    // Composição do grupo não é filtro de catálogo.
    ['para 2 crianças', {}],
    ['Tenho alguma reserva?', {}],
    // Negação: o hóspede quer as que dispensam reserva.
    ['Quais experiências não precisam de reserva?', {}],
    ['Tem alguma sem reserva?', {}],
  ])('%s -> %j', (text, expected) => {
    expect(extractSearchCues(text)).toEqual(expected);
  });
});

describe('temporal entities', () => {
  // 2026-10-24 is a Saturday.
  it('"próximo sábado" said on a Saturday is the following week', () => {
    expect(extractDate('próximo sábado', '2026-10-24')).toBe('2026-10-31');
    expect(extractDate('sábado', '2026-10-24')).toBe('2026-10-24');
  });

  it('keeps a period without presuming an exact time', () => {
    expect(extractEntities('amanhã de manhã', TODAY)).toEqual({ date: '2026-10-24', period: 'morning' });
  });

  it('a time range is not an exact time', () => {
    expect(extractEntities('depois das 15h', TODAY)).toEqual({ after: '15:00' });
  });

  it('a range with "da noite" is not widened to the whole period', () => {
    expect(extractEntities('depois das 8 da noite', TODAY)).toEqual({ after: '20:00' });
  });
});

describe('text summaries', () => {
  it('keeps whole sentences, drops emojis and inline price lists', async () => {
    const { summarizeText, stripSymbols } = await import('../common/text.js');
    const text =
      'Passeio ao Centro Histórico. A vista é espetacular. Saímos às 9h. 💰 Valores: • Adultos: R$ 100 • Crianças: R$ 80.';

    expect(summarizeText(text, 60)).toBe('Passeio ao Centro Histórico. A vista é espetacular.');
    expect(summarizeText(text)).not.toContain('R$');
    expect(stripSymbols('Omakase🇯🇵')).toBe('Omakase');
  });
});
