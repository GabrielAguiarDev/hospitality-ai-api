import { InternalServerErrorException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { ResortSnapshotGateway } from './resort-snapshot.gateway.js';

describe('ResortSnapshotGateway', () => {
  const query = vi.fn();
  const gateway = new ResortSnapshotGateway({ query } as unknown as DataSource);

  beforeEach(() => query.mockReset());

  describe('assertReadOnly', () => {
    it.each([
      'SELECT 1',
      '  select * from tb_x where a = ?  ',
      'WITH t AS (SELECT 1) SELECT * FROM t',
      "SELECT GROUP_CONCAT(a SEPARATOR '; ') FROM t",
      "SELECT 'DROP TABLE x; DELETE' AS s",
      "SELECT 'it\\'s; ok' AS s",
    ])('accepts %s', (sql) => {
      expect(() => gateway.assertReadOnly(sql)).not.toThrow();
    });

    it.each([
      'INSERT INTO t VALUES (1)',
      'UPDATE t SET a = 1',
      'DELETE FROM t',
      'DROP TABLE t',
      'ALTER TABLE t ADD c INT',
      'SET @a = 1',
      'SELECT 1; SELECT 2',
      'SELECT 1; DROP TABLE t',
      'SELECT * FROM t INTO OUTFILE "/tmp/x"',
      'SELECT * FROM t; ',
      'TRUNCATE t',
      '',
      '(SELECT 1)',
      'SELECT 1 /* x */ ; DELETE FROM t',
      'WITH t AS (SELECT 1) DELETE FROM x',
    ])('rejects %s', (sql) => {
      expect(() => gateway.assertReadOnly(sql)).toThrow(InternalServerErrorException);
    });
  });

  describe('select', () => {
    it('passes SQL and parameters to the DataSource and returns rows', async () => {
      query.mockResolvedValue([{ a: 1 }]);

      await expect(gateway.select('SELECT a FROM t WHERE b = ?', ['x'])).resolves.toEqual([{ a: 1 }]);
      expect(query).toHaveBeenCalledWith('SELECT a FROM t WHERE b = ?', ['x']);
    });

    it('defaults parameters to an empty array', async () => {
      query.mockResolvedValue([]);
      await gateway.select('SELECT 1');
      expect(query).toHaveBeenCalledWith('SELECT 1', []);
    });

    it('returns [] for non-array results', async () => {
      query.mockResolvedValue({ affectedRows: 0 });
      await expect(gateway.select('SELECT 1')).resolves.toEqual([]);
    });

    it('does not query when SQL is not read-only', async () => {
      await expect(gateway.select('DELETE FROM t')).rejects.toThrow(InternalServerErrorException);
      expect(query).not.toHaveBeenCalled();
    });

    it('propagates database errors', async () => {
      const failing = new ResortSnapshotGateway({
        query: async () => {
          throw new Error('db down');
        },
      } as unknown as DataSource);

      await expect(failing.select('SELECT 1')).rejects.toThrow('db down');
    });
  });
});
