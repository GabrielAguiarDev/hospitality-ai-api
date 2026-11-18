import type { KnowledgeDocument } from '../knowledge.service.js';

export interface KnowledgeSource {
  readonly name: string;
  load(resortId: string): Promise<KnowledgeDocument[]>;
}

export const RESORT_SNAPSHOT_SOURCE = 'resort-snapshot';
export const LEGACY_DEMO_SOURCE = 'mysql-resort-knowledge';

export function enabledKnowledgeSources(value: string | undefined): string[] {
  const sources = (value ?? '')
    .split(',')
    .map((source) => source.trim())
    .filter(Boolean);

  return sources.length ? [...new Set(sources)] : [RESORT_SNAPSHOT_SOURCE];
}
