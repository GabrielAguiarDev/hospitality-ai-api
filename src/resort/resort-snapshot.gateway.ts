import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export const RESORT_CONNECTION = 'resort';

// Palavras que nunca podem aparecer em uma consulta ao snapshot.
const FORBIDDEN_SQL =
  /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE|CREATE|RENAME|GRANT|REVOKE|CALL|LOAD|HANDLER|LOCK|UNLOCK|SET|INTO\s+OUTFILE|INTO\s+DUMPFILE)\b/i;

/**
 * Único ponto de acesso ao banco original do resort.
 *
 * O usuário do banco possui apenas SELECT; esta validação é
 * uma camada adicional e não substitui as permissões do MySQL.
 */
@Injectable()
export class ResortSnapshotGateway {
  constructor(
    @InjectDataSource(RESORT_CONNECTION)
    private readonly resortDb: DataSource,
  ) {}

  assertReadOnly(sql: string): void {
    // Literais (ex.: SEPARATOR '; ') não contam como comandos.
    const statement = sql.trim().replace(/'(?:[^'\\]|\\.)*'/g, "''");

    if (
      !/^(?:SELECT|WITH)\b/i.test(statement) ||
      statement.includes(';') ||
      FORBIDDEN_SQL.test(statement)
    ) {
      throw new InternalServerErrorException(
        'Consulta não permitida no snapshot do resort.',
      );
    }
  }

  async select<T>(sql: string, parameters: unknown[] = []): Promise<T[]> {
    this.assertReadOnly(sql);

    const rows: unknown = await this.resortDb.query(sql, parameters);

    return Array.isArray(rows) ? (rows as T[]) : [];
  }
}
