import 'reflect-metadata';

import { writeFile } from 'node:fs/promises';

import { buildKnowledgePrompt, knowledgeHistory, polishReply } from '../chat/chat-prompts.js';
import {
  EXPERIENCE_MODEL_INTENTS,
  EXPERIENCE_PROMPT,
  EXPERIENCE_SCHEMA,
  INTENT_SCHEMA,
  RESERVATION_PROMPT,
} from '../chat/intent-classifier.service.js';
import { toPlainText } from '../common/text.js';
import { chatRequest, llmSettings } from '../llm/llm-config.js';
import { RESERVATIONS_TOOL, TOOL_SYSTEM_PROMPT } from '../operations/operations-ai.service.js';

/**
 * Avaliação comparável entre modelos locais (Ollama), com os mesmos
 * prompts e schemas de produção. Mede, por modelo:
 * - acerto de intenção na classificação estruturada (JSON Schema);
 * - uso correto de function calling;
 * - qualidade das respostas do RAG (tamanho, Markdown, fórmulas de
 *   abertura, tratamento de gênero, dados ausentes das fontes);
 * - latência de cada chamada e tempo de carregamento do modelo.
 *
 * Interações sociais não usam o modelo (chat/social-replies.ts).
 *
 * Uso: pnpm models:evaluate
 *   OLLAMA_EVAL_MODELS=qwen3.5:2b-q4_K_M,qwen3.5:4b,qwen3:1.7b (padrão)
 *   OLLAMA_EVAL_OUTPUT=caminho.json para salvar o relatório.
 */

const MODELS = (process.env.OLLAMA_EVAL_MODELS ?? 'qwen3.5:2b-q4_K_M,qwen3.5:4b,qwen3:1.7b')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);

// Data no fuso do resort, como no ResortClock.
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.RESORT_TIMEZONE ?? 'America/Bahia' }).format(new Date());

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const LISTED_HISTORY: Turn[] = [
  { role: 'user', content: 'Quais experiências têm vagas amanhã?' },
  {
    role: 'assistant',
    content: 'Para amanhã, o cadastro registra vagas para:\n1. Cidade Histórica / City Tour — às 08:00\n2. Reserva da Jaqueira — às 09:00',
  },
];

// Mensagens que chegam ao modelo em produção (as regras não decidem).
const CLASSIFICATION_CASES: { message: string; history: Turn[]; schema: 'experience' | 'reservation'; expected: string }[] = [
  { message: 'e qual delas ainda sobra lugar pra gente?', history: LISTED_HISTORY, schema: 'experience', expected: 'experience.search' },
  { message: 'me conta mais sobre a do índio', history: LISTED_HISTORY, schema: 'experience', expected: 'experience.details' },
  { message: 'e essa sai muito caro?', history: LISTED_HISTORY, schema: 'experience', expected: 'experience.price' },
  { message: 'tem horário mais cedo nela?', history: LISTED_HISTORY, schema: 'experience', expected: 'experience.availability' },
  { message: 'o wi-fi pega na praia?', history: LISTED_HISTORY, schema: 'experience', expected: 'knowledge.search' },
  { message: 'Tenho alguma reserva?', history: [], schema: 'reservation', expected: 'reservation.list' },
  { message: 'Está confirmada?', history: [{ role: 'user', content: 'Tenho alguma reserva?' }, { role: 'assistant', content: 'Sua reserva na Trattoria Aurora é para 4 pessoas, às 20:00.' }], schema: 'reservation', expected: 'reservation.status' },
  { message: 'Qual o horário de funcionamento do restaurante?', history: [], schema: 'reservation', expected: 'knowledge.search' },
];

const TOOL_CASES = [
  { message: 'Quais são as minhas reservas de restaurante?', expectTool: true },
  { message: 'Qual o horário da piscina?', expectTool: false },
];

// Respostas do RAG com documentos fixos: concisão, neutralidade e fidelidade às fontes.
const DOCUMENTS = [
  {
    id: 'spa:funcionamento',
    title: 'Spa — funcionamento',
    content: 'O spa funciona todos os dias das 9h às 20h. Massagens precisam de agendamento na recepção do spa.',
    distance: 0.2,
  },
  {
    id: 'lazer:piscinas',
    title: 'Piscinas',
    content: 'A piscina central funciona das 8h às 18h. A piscina aquecida funciona das 10h às 22h. Toalhas na recepção da piscina.',
    distance: 0.25,
  },
];

const KNOWLEDGE_CASES: { message: string; history: Turn[]; mustMention: RegExp; mustNotMention?: RegExp }[] = [
  { message: 'Que horas abre o spa?', history: [], mustMention: /\b9\s*h|09:00/i },
  { message: 'A piscina aquecida fica aberta à noite?', history: [], mustMention: /22/ },
  { message: 'Preciso agendar a massagem?', history: [], mustMention: /agend/i },
  // A fonte não informa preço: o modelo não pode inventar.
  { message: 'Quanto custa a massagem?', history: [], mustMention: /n[ãa]o (?:consta|encontrei|tenho|temos|possuo|há|est[áa])/i, mustNotMention: /R\$|\breais\b/i },
  { message: 'E a piscina central?', history: [{ role: 'user', content: 'A piscina aquecida fica aberta à noite?' }, { role: 'assistant', content: 'Sim, a piscina aquecida funciona até as 22h.' }], mustMention: /18/ },
];

const FILLER = /^(?:ol[áa]|oi|claro|certamente|com certeza|[óo]tima pergunta)\b|espero ter ajudado|fico [àa] disposi/i;
const GENDERED = /\b(?:senhora?|bem[- ]vind[oa]|querid[oa]|prezad[oa]|car[oa] h[óo]spede)\b/i;

async function chat(
  model: string,
  body: Record<string, unknown>,
  options: { temperature?: number; format?: object; numPredict?: number } = { temperature: 0 },
): Promise<{ content: string; toolCalls: string[]; ms: number; loadMs: number }> {
  const settings = llmSettings();
  const started = performance.now();
  // Mesmo corpo de produção (num_ctx, keep_alive, think): sem recargas entre chamadas.
  const response = await fetch(`${settings.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...chatRequest(settings, model, options), ...body }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    message?: { content?: string; tool_calls?: { function?: { name?: string } }[] };
    load_duration?: number;
  };

  return {
    content: data.message?.content ?? '',
    toolCalls: (data.message?.tool_calls ?? []).map((call) => call.function?.name ?? ''),
    ms: Math.round(performance.now() - started),
    loadMs: Math.round((data.load_duration ?? 0) / 1e6),
  };
}

const userTurn = (message: string, history: Turn[]) => ({
  role: 'user',
  content: `HISTÓRICO:\n${history.map((turn) => `${turn.role}: ${turn.content}`).join('\n') || '(vazio)'}\n\nMENSAGEM ATUAL:\n${message}`,
});

async function installed(model: string): Promise<boolean> {
  const { baseUrl } = llmSettings();
  const response = await fetch(`${baseUrl}/api/tags`).catch(() => null);
  const data = response?.ok ? ((await response.json()) as { models?: { name: string }[] }) : { models: [] };
  return (data.models ?? []).some(({ name }) => name === model);
}

async function evaluate(model: string) {
  const classification = [];

  for (const item of CLASSIFICATION_CASES) {
    const [schema, system] =
      item.schema === 'experience' ? [EXPERIENCE_SCHEMA, EXPERIENCE_PROMPT] : [INTENT_SCHEMA, RESERVATION_PROMPT];
    const result = await chat(model, {
      messages: [{ role: 'system', content: system }, userTurn(item.message, item.history)],
    }, { format: schema, temperature: 0, numPredict: 120 });
    let intent: string | null = null;

    try {
      intent = (JSON.parse(result.content) as { intent?: string }).intent ?? null;
    } catch {
      intent = null;
    }

    const allowed = item.schema === 'experience' ? EXPERIENCE_MODEL_INTENTS : ['reservation.list', 'reservation.details', 'reservation.status', 'knowledge.search'];
    classification.push({
      message: item.message,
      expected: item.expected,
      got: intent,
      validSchema: intent !== null && (allowed as string[]).includes(intent),
      correct: intent === item.expected,
      ms: result.ms,
      loadMs: result.loadMs,
    });
  }

  const tools = [];

  for (const item of TOOL_CASES) {
    const result = await chat(model, {
      tools: [RESERVATIONS_TOOL],
      messages: [{ role: 'system', content: TOOL_SYSTEM_PROMPT }, { role: 'user', content: item.message }],
    });
    const called = result.toolCalls.includes(RESERVATIONS_TOOL.function.name);
    tools.push({ message: item.message, expectTool: item.expectTool, called, correct: called === item.expectTool, ms: result.ms, loadMs: result.loadMs });
  }

  const knowledge = [];

  for (const item of KNOWLEDGE_CASES) {
    const result = await chat(model, {
      messages: [
        { role: 'system', content: buildKnowledgePrompt(DOCUMENTS, TODAY) },
        ...knowledgeHistory(item.history),
        { role: 'user', content: item.message },
      ],
    }, {});
    const raw = toPlainText(result.content);
    const reply = polishReply(raw);
    const sentences = reply.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    const grounded = item.mustMention.test(reply) && !(item.mustNotMention?.test(reply) ?? false);

    knowledge.push({
      message: item.message,
      reply,
      chars: reply.length,
      sentences,
      markdown: result.content !== raw,
      // Medidos antes do pós-processamento: mostram o quanto o modelo segue o prompt.
      filler: FILLER.test(raw),
      gendered: GENDERED.test(raw),
      grounded,
      ok: sentences <= 3 && grounded && !GENDERED.test(reply),
      ms: result.ms,
      loadMs: result.loadMs,
    });
  }

  const rate = (items: { correct?: boolean; ok?: boolean }[]) =>
    Math.round((items.filter((item) => item.correct ?? item.ok).length / items.length) * 100);
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const all = [...classification, ...tools, ...knowledge];

  return {
    model,
    summary: {
      intentAccuracy: rate(classification),
      validSchema: Math.round((classification.filter((item) => item.validSchema).length / classification.length) * 100),
      toolCallingAccuracy: rate(tools),
      knowledgeQuality: rate(knowledge),
      avgReplyChars: Math.round(knowledge.reduce((sum, item) => sum + item.chars, 0) / knowledge.length),
      fillerReplies: knowledge.filter((item) => item.filler).length,
      medianLatencyMs: median(all.map((item) => item.ms)),
      // Carregamentos depois da primeira chamada indicam recarga do modelo.
      reloadMs: all.slice(1).reduce((sum, item) => sum + item.loadMs, 0),
    },
    classification,
    tools,
    knowledge,
  };
}

async function main() {
  const reports = [];
  const failures: { model: string; error: string }[] = [];

  for (const model of MODELS) {
    if (!(await installed(model))) {
      console.warn(`\n${model}: não instalado no Ollama (ollama pull ${model}). Ignorado.`);
      continue;
    }

    console.log(`\nAvaliando ${model}…`);
    let report: Awaited<ReturnType<typeof evaluate>>;

    try {
      report = await evaluate(model);
    } catch (error: unknown) {
      // Um modelo que falha (ex.: memória insuficiente) não interrompe os demais.
      const reason = error instanceof Error ? `${error.message}${error.cause ? ` (${String((error.cause as Error).message ?? error.cause)})` : ''}` : String(error);
      console.warn(`${model}: falhou durante a avaliação: ${reason}`);
      failures.push({ model, error: reason });
      continue;
    }

    reports.push(report);

    // Descarrega o modelo avaliado: os três juntos podem esgotar a memória.
    await fetch(`${llmSettings().baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
    }).catch(() => undefined);

    console.table(report.classification.map(({ message, expected, got, correct, ms }) => ({ message, expected, got, correct, ms })));
    console.table(report.tools);
    console.table(report.knowledge.map(({ message, reply, sentences, filler, gendered, grounded, ok, ms }) => ({
      message,
      reply: reply.slice(0, 80),
      sentences,
      filler,
      gendered,
      grounded,
      ok,
      ms,
    })));
  }

  console.log('\nResumo (percentuais e latência mediana):');
  console.table(Object.fromEntries(reports.map((report) => [report.model, report.summary])));

  if (reports.length === 0) {
    console.error('Nenhum modelo foi avaliado. Verifique se o Ollama está em execução e os modelos instalados.');
    process.exitCode = 1;
  }

  if (process.env.OLLAMA_EVAL_OUTPUT) {
    await writeFile(process.env.OLLAMA_EVAL_OUTPUT, JSON.stringify({ date: new Date().toISOString(), reports, failures }, null, 2));
    console.log(`Relatório salvo em ${process.env.OLLAMA_EVAL_OUTPUT}`);
  }
}

main().catch((error: unknown) => {
  console.error('Falha na avaliação dos modelos:', error);
  process.exitCode = 1;
});
