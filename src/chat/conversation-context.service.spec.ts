import { Logger } from '@nestjs/common';

import type { ConversationState } from '../contracts/conversation-state.js';

import type { IntentDecision } from './chat-intent.types.js';
import { ConversationContextService } from './conversation-context.service.js';

describe('ConversationContextService.resolve', () => {
  const service = new ConversationContextService({} as never);
  const decide = (intent: IntentDecision['intent'], extra: Partial<IntentDecision> = {}): IntentDecision => ({
    intent,
    detail: 'none',
    entities: {},
    ...extra,
  });
  const listed = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `e${index + 1}`, title: `Experiência ${index + 1}` }));

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a "yes" to a pending question targets the entity of the question', () => {
    const state: ConversationState = {
      pendingQuestion: { intent: 'experience.availability', targetId: 'e7' },
      experience: { selectedId: 'e1' },
    };

    expect(service.resolve('Sim', decide('experience.availability', { answersPending: true }), state).target).toEqual({
      kind: 'experience',
      id: 'e7',
      via: 'pending_question',
    });
  });

  it('"essa" after a single-item list targets that item', () => {
    const state: ConversationState = { lastIntent: 'experience.search', experience: { listed: listed(1) } };

    expect(service.resolve('E como é essa experiência?', decide('experience.details'), state).target).toMatchObject({
      id: 'e1',
      via: 'single_listed',
    });
  });

  it('"essa" after a list of several is left for the handler to ask which one', () => {
    const state: ConversationState = {
      lastIntent: 'experience.search',
      experience: { listed: listed(3), selectedId: 'e2' },
    };

    expect(service.resolve('E como é essa?', decide('experience.details'), state).target).toBeUndefined();
  });

  it('"essa" after talking about the selected experience targets it', () => {
    const state: ConversationState = {
      lastIntent: 'experience.price',
      experience: { listed: listed(3), selectedId: 'e2' },
    };

    expect(service.resolve('E dessa, tem vaga?', decide('experience.availability'), state).target).toMatchObject({
      id: 'e2',
      via: 'demonstrative',
    });
  });

  it('a position ("a segunda") is resolved by the handler, not by context', () => {
    const state: ConversationState = { lastIntent: 'experience.search', experience: { listed: listed(1) } };

    expect(
      service.resolve('a segunda', decide('experience.details', { entities: { ordinal: 2 } }), state).target,
    ).toBeUndefined();
  });

  it('applies a single listed restaurant only right after a restaurant list', () => {
    const restaurant = { listed: [{ id: 'b1', name: 'Bar Mirante' }] };

    expect(
      service.resolve('Como é?', decide('restaurant.details'), { lastIntent: 'restaurant.list', restaurant }).target,
    ).toMatchObject({ id: 'b1', via: 'single_listed' });
    expect(
      service.resolve('Como é?', decide('restaurant.details'), { lastIntent: 'restaurant.details', restaurant }).target,
    ).toBeUndefined();
  });

  it('does not read "está" as a demonstrative', () => {
    const state: ConversationState = { lastIntent: 'restaurant.details', restaurant: { selectedId: 'r1' } };

    expect(service.resolve('O Restaurante Central está aberto?', decide('restaurant.details'), state).target).toBeUndefined();
  });

  it('never applies an experience to a restaurant question (topic change)', () => {
    const state: ConversationState = { lastIntent: 'experience.search', experience: { listed: listed(1), selectedId: 'e1' } };

    expect(service.resolve('E os restaurantes?', decide('restaurant.list'), state).target).toBeUndefined();
  });

  it('keeps the pending question only for the next message', () => {
    const state: ConversationState = { pendingQuestion: { intent: 'experience.availability', targetId: 'e1' } };

    expect(service.afterKnowledge(state, 'knowledge.search').pendingQuestion).toBeUndefined();
    expect(
      service.afterOperation({ tool: 'experiences.list', reply: '', state }, state, 'experience.search').pendingQuestion,
    ).toBeUndefined();
    expect(service.afterConversation(state, decide('conversation.general', { declinesPending: true })).pendingQuestion)
      .toBeUndefined();
    // "Obrigado!" também encerra a pergunta: um "sim" depois não responde a ela.
    expect(service.afterConversation(state, decide('conversation.general')).pendingQuestion).toBeUndefined();
    expect(
      service.afterConversation({ ...state, experience: { pendingPreviewId: 'p1' } }, decide('conversation.general'))
        .experience?.pendingPreviewId,
    ).toBe('p1');
  });
});
