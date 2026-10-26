import { ConfigService } from '@nestjs/config';

import type { ChatIntent } from '../chat/chat-intent.types.js';
import { NAVIGATION_SCREENS } from '../contracts/chat-actions.js';
import { INTENT_TOOL_MAP } from '../operations/intent-tool-map.js';
import { OperationsToolRegistryService } from '../operations/operations-tool-registry.service.js';

import {
  APP_MODULES,
  CAPABILITIES,
  SCREEN_PARAMS,
  capabilitiesOverview,
  capabilityForIntent,
  capabilityOf,
  selectCapabilities,
} from './capabilities.js';

// Toda intenção do tipo ChatIntent. O Record força a lista a acompanhar o tipo:
// uma intenção nova sem entrada aqui quebra a compilação.
const ALL_INTENTS: Record<ChatIntent, true> = {
  'reservation.list': true,
  'reservation.details': true,
  'reservation.status': true,
  'request.list': true,
  'request.status': true,
  'request.catalog': true,
  'request.create': true,
  'request.confirm': true,
  'request.cancel': true,
  'boutique.info': true,
  'spa.info': true,
  'tips.list': true,
  'quiz.info': true,
  'esg.info': true,
  'restaurant.booking': true,
  'restaurant.list': true,
  'restaurant.details': true,
  'event.list': true,
  'experience.list': true,
  'experience.search': true,
  'experience.details': true,
  'experience.availability': true,
  'experience.price': true,
  'experience.booking': true,
  'experience.booking.confirm': true,
  'experience.booking.cancel': true,
  'experience.reservations': true,
  'knowledge.search': true,
  'conversation.greeting': true,
  'conversation.general': true,
  'conversation.external': true,
};

const OPERATIONAL = (Object.keys(ALL_INTENTS) as ChatIntent[]).filter(
  (intent) => intent !== 'knowledge.search' && !intent.startsWith('conversation.'),
);

describe('capability catalog', () => {
  it('declares one capability per app module, without duplicates', () => {
    expect(CAPABILITIES.map(({ module }) => module)).toEqual([...APP_MODULES]);
    expect(new Set(CAPABILITIES.map(({ module }) => module)).size).toBe(CAPABILITIES.length);
  });

  it.each(OPERATIONAL)('assigns the operational intent %s to a capability', (intent) => {
    expect(capabilityForIntent(intent), intent).toBeDefined();
  });

  it('does not assign knowledge or conversation intents to any capability', () => {
    for (const intent of ['knowledge.search', 'conversation.greeting', 'conversation.general', 'conversation.external'] as const) {
      expect(capabilityForIntent(intent), intent).toBeUndefined();
    }
  });

  it('maps every operational intent to a tool that exists in the registry', () => {
    const registry = new OperationsToolRegistryService(
      ...(Array.from({ length: 2 }, () => ({})) as [never, never]),
      new ConfigService({}),
      ...(Array.from({ length: 10 }, () => ({})) as [never, never, never, never, never, never, never, never, never, never]),
    );
    const tools = new Set(registry.listTools().map(({ name }) => name));

    expect(Object.keys(INTENT_TOOL_MAP).sort()).toEqual([...OPERATIONAL].sort());
    for (const intent of OPERATIONAL) {
      expect(tools.has(INTENT_TOOL_MAP[intent as keyof typeof INTENT_TOOL_MAP]), `${intent} -> ${INTENT_TOOL_MAP[intent as keyof typeof INTENT_TOOL_MAP]}`).toBe(true);
    }
  });

  it('only lists intents that are operational and mapped to a tool', () => {
    for (const capability of CAPABILITIES) {
      for (const intent of capability.intents) {
        expect(OPERATIONAL, `${capability.module}: ${intent}`).toContain(intent);
      }
    }
  });

  it('points every capability to a navigable screen that accepts its own params', () => {
    for (const { module, screen } of CAPABILITIES) {
      expect(NAVIGATION_SCREENS, module).toContain(screen);
      expect(SCREEN_PARAMS, module).toHaveProperty(screen);
    }
    // Todas as telas do contrato têm um dono no catálogo.
    expect(new Set(CAPABILITIES.map(({ screen }) => screen))).toEqual(new Set(NAVIGATION_SCREENS));
  });

  it('keeps the screen allow-list restricted to id-like params', () => {
    expect(SCREEN_PARAMS.Requests).toEqual(['departmentId']);
    expect(SCREEN_PARAMS.Gastronomy).toEqual(['restaurantId']);
    expect(SCREEN_PARAMS.Experiences).toEqual(['experienceId']);
    expect(SCREEN_PARAMS.Quiz).toEqual([]);
  });

  it('describes limits for the modules that never write to the resort', () => {
    expect(capabilityOf('requests').limitations.join(' ')).toMatch(/simulad/i);
    expect(capabilityOf('spa').limitations.join(' ')).toMatch(/agendamento/i);
    expect(capabilityOf('boutique').kinds).not.toContain('write');
  });
});

describe('selectCapabilities', () => {
  it.each([
    ['Quais produtos tem na boutique?', ['boutique']],
    ['Quanto custa a massagem relaxante?', ['spa']],
    ['Tem quiz hoje?', ['quiz']],
    ['O que vocês fazem de ESG?', ['esg']],
    ['Preciso falar com a governança', ['requests']],
    ['Quero ver os restaurantes', ['gastronomy']],
  ] as const)('picks only the cited module for "%s"', (message, modules) => {
    expect(selectCapabilities(message).map(({ module }) => module)).toEqual(modules);
  });

  it('caps the selection at 2 modules by default, in catalog order', () => {
    const message = 'boutique spa quiz esg dicas eventos restaurantes solicitações';
    const picked = selectCapabilities(message).map(({ module }) => module);

    expect(picked).toHaveLength(2);
    expect(picked).toEqual(['requests', 'gastronomy']);
    expect(selectCapabilities(message, 3)).toHaveLength(3);
  });

  it.each(['Bom dia!', 'Obrigado', 'Qual a senha do wifi?', '', '   '])('returns [] for unrelated text %j', (message) => {
    expect(selectCapabilities(message)).toEqual([]);
  });

  it('ignores accents and case', () => {
    expect(selectCapabilities('SOLICITAÇÕES').map(({ module }) => module)).toEqual(['requests']);
    expect(selectCapabilities('Manutenção').map(({ module }) => module)).toEqual(['requests']);
  });
});

describe('capabilitiesOverview', () => {
  it('names every module label once, ending with "e"', () => {
    const overview = capabilitiesOverview();

    for (const { label } of CAPABILITIES) expect(overview).toContain(label);
    expect(overview).toMatch(/ e Quiz$/);
    expect(overview).not.toContain('\n');
  });
});
