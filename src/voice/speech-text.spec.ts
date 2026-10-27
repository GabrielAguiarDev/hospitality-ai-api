import { navigateAction, type ChatAction } from '../contracts/chat-actions.js';

import { speechText } from './speech-text.js';

const OPTIONS = {
  type: 'experience.options',
  label: 'Experiências',
  date: '2026-10-24',
  options: [],
} as unknown as ChatAction;

describe('speechText', () => {
  it('keeps a plain conversational reply unchanged', () => {
    const reply = 'A Trattoria Aurora funciona das 19h às 23h. Quer que eu abra a Gastronomia?';

    expect(speechText(reply, [], 400)).toBe(reply);
  });

  it('keeps facts and numbers exactly as written', () => {
    expect(speechText('Sua reserva é para 4 pessoas, em 24/10/2026 às 20:00, por R$ 120,00.', null, 400)).toBe(
      'Sua reserva é para 4 pessoas, em 24/10/2026 às 20:00, por R$ 120,00.',
    );
  });

  it('removes Markdown formatting', () => {
    expect(speechText('## Horários\n**Trattoria Aurora**: das 19h às 23h. Veja [o cardápio](https://x.y/menu).', [], 400)).toBe(
      'Horários. Trattoria Aurora: das 19h às 23h. Veja o cardápio.',
    );
  });

  it('drops JSON and code blocks', () => {
    const reply = 'Reserva registrada.\n```json\n{"bookingId": "abc"}\n```\n{"cardId": "1"}\n"status": "confirmed"';

    expect(speechText(reply, [], 400)).toBe('Reserva registrada.');
  });

  it('keeps prose lines that only look structured', () => {
    expect(speechText('[Importante] O check-out é às 12h.\n"Sunset Bar": aberto até 23h.', [], 400)).toBe(
      '[Importante] O check-out é às 12h. "Sunset Bar": aberto até 23h.',
    );
  });

  it('drops internal identifiers and URLs, and labels left empty by them', () => {
    const reply = [
      'Pré-reserva criada (6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f).',
      'ID: 0b5c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f',
      'Link: https://resort.example/booking/123',
      'Hash 9f86d081884c7d659a2feaa0c55ad015 registrado.',
    ].join('\n');

    expect(speechText(reply, [], 400)).toBe('Pré-reserva criada. Hash registrado.');
  });

  it('keeps an intro that ends with a colon', () => {
    expect(speechText('Encontrei 1 reserva de restaurante no seu cadastro:\nData: 24/10/2026 às 20:00', [], 400)).toBe(
      'Encontrei 1 reserva de restaurante no seu cadastro. Data: 24/10/2026 às 20:00.',
    );
  });

  it('with cards, narrates only the introduction and the conclusion, not the listed items', () => {
    const reply = [
      'Para amanhã, há vagas registradas em 3 experiências:',
      '1. Passeio de barco — 09:00, 10 vagas',
      '2. Trilha ecológica — 14:00, 6 vagas',
      '- Aula de surfe — 16:00',
      'Quer que eu reserve alguma delas?',
    ].join('\n');

    expect(speechText(reply, [OPTIONS], 400)).toBe(
      'Para amanhã, há vagas registradas em 3 experiências. Quer que eu reserve alguma delas?',
    );
  });

  it('without cards, reads list items without their markers', () => {
    const reply = 'Opções de hoje:\n1. Passeio de barco\n2. Trilha ecológica';

    expect(speechText(reply, [navigateAction('Experiences', 'Abrir Experiências')], 400)).toBe(
      'Opções de hoje. Passeio de barco. Trilha ecológica.',
    );
  });

  it('removes emojis', () => {
    expect(speechText('Bom dia! ☀️ O Omakase🇯🇵 abre às 19h.', [], 400)).toBe('Bom dia! O Omakase abre às 19h.');
  });

  it('cuts long replies at whole sentences', () => {
    const reply = 'Primeira frase curta. Segunda frase também curta. Terceira frase que não cabe.';

    expect(speechText(reply, [], 50)).toBe('Primeira frase curta. Segunda frase também curta.');
  });

  it('cuts a single oversized sentence at a word boundary', () => {
    const result = speechText('palavra '.repeat(100), [], 40);

    expect(result.length).toBeLessThanOrEqual(41);
    expect(result).toMatch(/^palavra( palavra)*…$/);
  });

  it.each(['', '   ', '```\n{"a": 1}\n```', '{"reply": "x"}', '🎉🎉', 'ID: 6f1c2a5e-8c1d-4b7a-9e2f-3a4b5c6d7e8f'])(
    'returns empty text for %j, with nothing to narrate',
    (reply) => {
      expect(speechText(reply, [], 400)).toBe('');
    },
  );
});
