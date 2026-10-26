import type { ConversationIntent, HistoryEntry } from './chat-intent.types.js';
import { EXTERNAL_REPLY, socialKind, socialReply, type SocialKind } from './social-replies.js';

const PENDING = 'A pré-reserva continua aguardando: confirme pelo card ou responda "confirmo".';
const NO_CONTEXT = { history: [] as HistoryEntry[], pendingBooking: false };
const WITH_HISTORY: HistoryEntry[] = [
  { role: 'user', content: 'Oi' },
  { role: 'assistant', content: 'Olá, sou o Yago, concierge digital do resort. Como posso ajudar?' },
];

const sentences = (text: string) => text.split(/[.!?]+(?:\s|$)/).filter(Boolean);
const GENDERED = /senhor|senhora|bem-vind|querid|caro |prezad/i;

const CASES: [string, ConversationIntent, SocialKind][] = [
  ['Obrigado!', 'conversation.general', 'thanks'],
  ['Obrigadaaa', 'conversation.general', 'thanks'],
  ['Valeu, Yago!', 'conversation.general', 'thanks'],
  ['Tchau', 'conversation.general', 'farewell'],
  ['Até mais', 'conversation.general', 'farewell'],
  ['Muito bom, adorei!', 'conversation.general', 'compliment'],
  ['Quem é você?', 'conversation.general', 'identity'],
  ['O que você pode fazer?', 'conversation.general', 'help'],
  ['Olá', 'conversation.greeting', 'greeting'],
  ['Bom dia', 'conversation.greeting', 'greeting'],
  ['Ok', 'conversation.general', 'acknowledgement'],
  ['Talvez depois', 'conversation.general', 'decline'],
  ['Vai chover amanhã?', 'conversation.external', 'external'],
];

describe('socialKind', () => {
  it.each(CASES)('classifies %j as %s', (message, intent, kind) => {
    expect(socialKind(message, intent)).toBe(kind);
  });

  it('treats a "no" to a pending question as a decline, even over other cues', () => {
    expect(socialKind('Não', 'conversation.general', true)).toBe('decline');
    expect(socialKind('Não, obrigado', 'conversation.general', true)).toBe('decline');
  });

  it('collapses stretched letters ("Oiii", "Obrigadooo")', () => {
    expect(socialKind('Obrigadooo', 'conversation.general')).toBe('thanks');
    expect(socialKind('Oiii', 'conversation.greeting')).toBe('greeting');
  });

  it('gives external intent priority over every other cue', () => {
    expect(socialKind('Obrigado, vai chover?', 'conversation.external')).toBe('external');
  });
});

describe('socialReply', () => {
  it.each(CASES)('replies to %j with at most two sentences and no gendered forms', (message, intent) => {
    const reply = socialReply(message, intent, NO_CONTEXT);

    expect(reply.length).toBeGreaterThan(0);
    expect(sentences(reply).length).toBeLessThanOrEqual(2);
    expect(reply).not.toMatch(GENDERED);
    expect(reply).not.toContain('\n');
  });

  it.each(CASES)('keeps %j short even with a pending pre-booking', (message, intent) => {
    const reply = socialReply(message, intent, { ...NO_CONTEXT, pendingBooking: true });

    expect(sentences(reply).length).toBeLessThanOrEqual(2);
    expect(reply).not.toMatch(GENDERED);
  });

  it('never invents resort data (hours, prices, places)', () => {
    for (const [message, intent] of CASES) {
      expect(socialReply(message, intent, NO_CONTEXT)).not.toMatch(/\d{1,2}h|R\$|\d{1,2}:\d{2}/);
    }
  });

  describe('greeting', () => {
    it('introduces the Yago only on the first contact', () => {
      const first = socialReply('Olá', 'conversation.greeting', NO_CONTEXT);
      const later = socialReply('Olá', 'conversation.greeting', { ...NO_CONTEXT, history: WITH_HISTORY });

      expect(first).toBe('Olá, sou o Yago, concierge digital do resort. Como posso ajudar?');
      expect(later).toBe('Olá! Como posso ajudar?');
      expect(later).not.toContain('Yago');
    });

    it('echoes the salutation of the day', () => {
      expect(socialReply('Bom dia', 'conversation.greeting', NO_CONTEXT)).toBe(
        'Bom dia, sou o Yago, concierge digital do resort. Como posso ajudar?',
      );
      expect(socialReply('boa noite!', 'conversation.greeting', { ...NO_CONTEXT, history: WITH_HISTORY })).toBe(
        'Boa noite! Como posso ajudar?',
      );
    });

    it('answers "tudo bem?" without a gendered form', () => {
      const first = socialReply('Oi, tudo bem?', 'conversation.greeting', NO_CONTEXT);
      const later = socialReply('Oi, tudo bem?', 'conversation.greeting', { ...NO_CONTEXT, history: WITH_HISTORY });

      expect(first).toBe('Tudo ótimo por aqui, sou o Yago, concierge digital do resort. Como posso ajudar?');
      expect(later).toBe('Tudo ótimo por aqui! Como posso ajudar?');
    });

    it('does not introduce itself in other kinds of replies', () => {
      expect(socialReply('Obrigado', 'conversation.general', NO_CONTEXT)).not.toContain('sou o Yago');
    });
  });

  describe('variation', () => {
    it.each(['Obrigado!', 'Tchau', 'Ok', 'Que legal!'] as const)('does not repeat the previous assistant reply to %j', (message) => {
      const intent: ConversationIntent = 'conversation.general';
      let history: HistoryEntry[] = [];
      const replies: string[] = [];

      for (let turn = 0; turn < 6; turn += 1) {
        const reply = socialReply(message, intent, { history, pendingBooking: false });
        replies.push(reply);
        history = [...history, { role: 'user', content: message }, { role: 'assistant', content: reply }];
      }

      replies.slice(1).forEach((reply, index) => expect(reply).not.toBe(replies[index]));
    });

    it('avoids the last reply even when the turn counter would pick it again', () => {
      const last = 'Por nada! Precisa de mais alguma coisa?';
      const history: HistoryEntry[] = [{ role: 'assistant', content: last }];

      expect(socialReply('Obrigado', 'conversation.general', { history, pendingBooking: false })).not.toBe(last);
    });

    it('uses the only available variant when there is a single one (help)', () => {
      const history: HistoryEntry[] = [{ role: 'assistant', content: 'Posso ajudar com restaurantes, experiências, eventos, suas reservas e solicitações. Do que você precisa?' }];

      expect(socialReply('O que você faz?', 'conversation.general', { history, pendingBooking: false })).toContain('Do que você precisa?');
    });
  });

  describe('pending pre-booking', () => {
    it.each([
      ['Obrigado!', 'conversation.general', 'Por nada!'],
      ['Tchau', 'conversation.general', 'Até mais!'],
      ['Que legal!', 'conversation.general', 'Que bom que gostou!'],
      ['Olá', 'conversation.greeting', 'Olá!'],
      ['Ok', 'conversation.general', 'Certo!'],
      ['Talvez depois', 'conversation.general', 'Tudo bem!'],
    ] as const)('appends the reminder to %j', (message, intent, opening) => {
      const reply = socialReply(message, intent, { ...NO_CONTEXT, pendingBooking: true });

      expect(reply).toBe(`${opening} ${PENDING}`);
    });

    it('does not remind when there is no pending pre-booking', () => {
      for (const [message, intent] of CASES) {
        expect(socialReply(message, intent, NO_CONTEXT)).not.toContain('pré-reserva');
      }
    });

    it('keeps the identity, help and external answers unchanged', () => {
      const pending = { ...NO_CONTEXT, pendingBooking: true };

      expect(socialReply('Quem é você?', 'conversation.general', pending)).toBe(socialReply('Quem é você?', 'conversation.general', NO_CONTEXT));
      expect(socialReply('O que você faz?', 'conversation.general', pending)).toBe(socialReply('O que você faz?', 'conversation.general', NO_CONTEXT));
      expect(socialReply('Vai chover?', 'conversation.external', pending)).toBe(EXTERNAL_REPLY);
    });
  });

  describe('decline', () => {
    it('answers a "no" to a pending question without offering anything', () => {
      const reply = socialReply('Não', 'conversation.general', { ...NO_CONTEXT, declinesPending: true });

      expect(reply).toMatch(/^(Tudo bem|Sem problemas)!/);
      expect(sentences(reply)).toHaveLength(2);
    });

    it('with a pending pre-booking, a decline of another question still reminds of the booking', () => {
      expect(socialReply('Não', 'conversation.general', { ...NO_CONTEXT, pendingBooking: true, declinesPending: true })).toBe(`Tudo bem! ${PENDING}`);
    });
  });

  describe('external', () => {
    it('states the limitation without claiming weather or real-time facts', () => {
      const reply = socialReply('Qual a previsão do tempo?', 'conversation.external', NO_CONTEXT);

      expect(reply).toBe(EXTERNAL_REPLY);
      expect(reply).toMatch(/Não tenho acesso/);
      expect(reply).not.toMatch(/\d+\s*°|graus|ensolarado|vai chover/i);
    });
  });

  describe('identity', () => {
    it('introduces the Yago, even after the first contact', () => {
      const reply = socialReply('Quem é você?', 'conversation.general', { history: WITH_HISTORY, pendingBooking: false });

      expect(reply).toContain('Sou o Yago');
      expect(sentences(reply).length).toBeLessThanOrEqual(2);
    });
  });
});
