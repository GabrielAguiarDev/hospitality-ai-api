import { normalizeText } from '../../common/text.js';
import type { ConversationState } from '../../contracts/conversation-state.js';

import { detectRequestCatalogOrCreate, detectRequestFollowUp } from './requests.js';

const detect = (message: string, state?: ConversationState) => detectRequestCatalogOrCreate(normalizeText(message), state);
const followUp = (message: string, state?: ConversationState) => detectRequestFollowUp(normalizeText(message), state);

describe('detectRequestCatalogOrCreate', () => {
  it.each([
    'Solicitações.',
    'Solicitações',
    'as solicitações',
    'Chamados',
    'Quais são as opções de solicitações?',
    'Quais tipos de solicitação posso fazer?',
    'Como faço uma solicitação?',
    'Governança',
    'Manutenção',
  ])('detects the catalog for "%s"', (message) => {
    expect(detect(message)).toBe('request.catalog');
  });

  it.each([
    'Quero fazer uma solicitação de mais toalhas para a governança.',
    'Preciso de toalhas.',
    'Obrigado, me traga um travesseiro extra',
    'a TV não liga',
    'o wifi não conecta',
    'O chuveiro está quebrado',
    'Preciso de governança',
    'Quero abrir um chamado',
    'Acabou o sabonete',
    'Podem me mandar mais duas toalhas?',
  ])('detects a new request for "%s"', (message) => {
    expect(detect(message)).toBe('request.create');
  });

  it.each([
    'Qual a senha do wifi?',
    'Que horas abre o spa?',
    'Qual o horário da área de lazer?',
    'Tem algum evento hoje?',
    'Quero reservar uma mesa',
    'Preciso de uma reserva no restaurante',
    'Quais experiências posso fazer?',
    'Obrigado!',
    'Bom dia',
    'Tenho alguma reserva?',
    'Quais produtos tem na boutique?',
  ])('does not claim "%s"', (message) => {
    expect(detect(message)).toBeNull();
  });

  it('lets another domain win when no request noun is present', () => {
    expect(detect('Preciso de toalhas para o passeio')).toBeNull();
    expect(detect('Quero toalhas no jantar do restaurante')).toBeNull();
  });

  it('keeps the request when the noun is explicit even with another domain word', () => {
    expect(detect('Faça uma solicitação de toalhas para depois do jantar')).toBe('request.create');
  });

  it('does not treat a question about room objects without a problem as a request', () => {
    expect(detect('Tem TV no quarto?')).toBeNull();
    expect(detect('Como funciona o ar condicionado?')).toBeNull();
  });
});

it('detects "O ar condicionado não está gelando" as a new request', () => {
  expect(detect('O ar condicionado não está gelando')).toBe('request.create');
});

it('detects the equivalent "O ar condicionado não gela"', () => {
  expect(detect('O ar condicionado não gela')).toBe('request.create');
});

describe('detectRequestCatalogOrCreate - negations and look-alikes', () => {
  it.each([
    'não preciso de mais toalhas',
    'Não preciso de toalhas, obrigado',
    'sem necessidade de toalhas',
    'limpeza de pele',
    'Quero uma massagem',
    'Quero fazer manicure',
    'a rede sem sinal',
    'a rede wi-fi do spa',
    'um passeio ao ar livre',
    'Tem ar no quarto?',
  ])('does not open a request for "%s"', (message) => {
    expect(detect(message)).toBeNull();
  });

  it.each([
    ['o ar não gela', 'request.create'],
    ['ar condicionado não funciona', 'request.create'],
    ['estou sem toalhas', 'request.create'],
    ['ficamos sem sabonete', 'request.create'],
    ['fiquei sem shampoo', 'request.create'],
  ] as const)('still opens a request for "%s"', (message, intent) => {
    expect(detect(message)).toBe(intent);
  });

  it('does not read a bare "sem" as a missing item', () => {
    expect(detect('café sem açúcar e toalhas')).toBeNull();
  });
});

describe('detectRequestFollowUp', () => {
  const asking: ConversationState = { topic: 'request', request: { departmentId: '3' } };

  it('reads a short answer as the item after the assistant asked about a department', () => {
    expect(followUp('toalha de banho', asking)).toBe('request.create');
    expect(followUp('dois travesseiros', asking)).toBe('request.create');
  });

  it.each(['tem show hoje?', 'e os restaurantes?', 'quais massagens?', 'Tem quiz hoje?', 'não preciso de nada'])(
    'does not capture "%s" (other domain or negation)',
    (message) => {
      expect(followUp(message, asking)).toBeNull();
    },
  );

  it('ignores long messages', () => {
    expect(followUp('na verdade eu queria saber outra coisa bem diferente disso aqui', asking)).toBeNull();
  });

  it('is inert without a department in conversation', () => {
    expect(followUp('toalha de banho', { topic: 'request', request: {} })).toBeNull();
    expect(followUp('toalha de banho', { topic: 'event', request: { departmentId: '3' } })).toBeNull();
    expect(followUp('toalha de banho', undefined)).toBeNull();
    expect(followUp('toalha de banho', {})).toBeNull();
  });

  it('is inert while a preview waits for confirmation', () => {
    expect(followUp('toalha', { topic: 'request', request: { departmentId: '3', pendingPreviewId: 'p1' } })).toBeNull();
  });
});
