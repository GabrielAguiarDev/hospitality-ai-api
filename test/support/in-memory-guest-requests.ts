import { vi } from 'vitest';
import type { DataSource } from 'typeorm';

import { SimulatedGuestRequest } from '../../src/requests/entities/simulated-guest-request.entity.js';

type Row = SimulatedGuestRequest;
type Where = Record<string, unknown>;

interface Operator {
  type: string;
  value: unknown;
}

const isOperator = (value: unknown): value is Operator =>
  typeof value === 'object' && value !== null && 'type' in value && '_value' in value ? true : false;

// FindOperator do TypeORM: MoreThanOrEqual e In são os usados pelo serviço.
function matchesValue(actual: unknown, expected: unknown): boolean {
  if (isOperator(expected)) {
    const operator = expected as unknown as { type: string; _value: unknown };
    if (operator.type === 'in') return (operator._value as unknown[]).includes(actual);
    if (operator.type === 'lessThan') return (actual as Date) < (operator._value as Date);
    if (operator.type === 'moreThanOrEqual') return (actual as Date) >= (operator._value as Date);
    throw new Error(`Unsupported operator ${operator.type}`);
  }
  return actual === expected;
}

const matches = (row: Row, where: Where) =>
  Object.entries(where).every(([key, expected]) => matchesValue((row as unknown as Where)[key], expected));

/**
 * DataSource falso para a tabela simulated_guest_requests: só o necessário
 * para GuestRequestService (count/find/findOne/insert/update/create e
 * transaction). A transação confirma as escritas apenas se o callback resolver.
 */
export class InMemoryGuestRequests {
  readonly rows = new Map<string, Row>();
  private lock: Promise<void> = Promise.resolve();

  private apply(values: Partial<Row>, row: Row) {
    Object.assign(row, values, { updatedAt: new Date() });
  }

  private readonly repository = {
    create: (values: Partial<Row>) => ({ ...values }) as Row,
    insert: vi.fn(async (row: Row) => {
      this.rows.set(row.id, { ...row, createdAt: new Date(), updatedAt: new Date() });
    }),
    count: vi.fn(async ({ where }: { where: Where }) => [...this.rows.values()].filter((row) => matches(row, where)).length),
    find: vi.fn(async ({ where, order, take }: { where: Where; order?: { confirmedAt?: 'DESC' }; take?: number }) => {
      let found = [...this.rows.values()].filter((row) => matches(row, where));
      if (order?.confirmedAt === 'DESC') {
        found = found.sort((a, b) => (b.confirmedAt?.getTime() ?? 0) - (a.confirmedAt?.getTime() ?? 0));
      }
      return (take ? found.slice(0, take) : found).map((row) => structuredClone(row));
    }),
    update: vi.fn(async (where: Where, values: Partial<Row>) => {
      const found = [...this.rows.values()].filter((row) => matches(row, where));
      found.forEach((row) => this.apply(values, row));
      return { affected: found.length };
    }),
  };

  private readonly manager = {
    findOne: vi.fn(async (_entity: unknown, { where }: { where: Where }) => {
      const found = [...this.rows.values()].find((row) => matches(row, where));
      return found ? structuredClone(found) : null;
    }),
    update: vi.fn(async (_entity: unknown, where: Where, values: Partial<Row>) => {
      const found = [...this.rows.values()].filter((row) => matches(row, where));
      found.forEach((row) => this.apply(values, row));
      return { affected: found.length };
    }),
  };

  readonly dataSource = {
    getRepository: vi.fn((entity: unknown) => {
      if (entity !== SimulatedGuestRequest) throw new Error('Unexpected repository in InMemoryGuestRequests');
      return this.repository;
    }),
    // Serializa as transações, como o SELECT ... FOR UPDATE do serviço faz no banco.
    transaction: vi.fn(async <T>(work: (manager: InMemoryGuestRequests['manager']) => Promise<T>) => {
      const run = this.lock.then(() => work(this.manager));
      this.lock = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    }),
  } as unknown as DataSource;

  /** Cópia da linha, para asserções. */
  get(id: string): Row | undefined {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : undefined;
  }

  all(): Row[] {
    return [...this.rows.values()].map((row) => structuredClone(row));
  }
}
