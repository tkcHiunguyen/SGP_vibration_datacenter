import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveActiveMySqlAccess } from './mysql-access.js';

test('falls back to in-memory persistence when configured MySQL is unavailable', async () => {
  let closeCalls = 0;
  const unavailableMysql = {
    async ensureReady() {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:3306') as Error & { code: string };
      error.code = 'ECONNREFUSED';
      throw error;
    },
    async close() {
      closeCalls += 1;
    },
  };

  const runtime = await resolveActiveMySqlAccess({ candidate: unavailableMysql });

  assert.equal(runtime.access, null);
  assert.deepEqual(runtime.status, {
    mode: 'in-memory',
    configured: true,
    ready: false,
    reason: 'unavailable',
    errorCode: 'ECONNREFUSED',
  });
  assert.equal(closeCalls, 1);
});

test('keeps fail-fast behavior when MySQL fallback is disabled', async () => {
  const unavailableMysql = {
    async ensureReady() {
      throw new Error('database unavailable');
    },
    async close() {},
  };

  await assert.rejects(
    () => resolveActiveMySqlAccess({ candidate: unavailableMysql, fallbackOnUnavailable: false }),
    /database unavailable/,
  );
});

test('does not hide non-availability MySQL initialization errors', async () => {
  const mysqlWithSchemaError = {
    async ensureReady() {
      const error = new Error('You have an error in your SQL syntax') as Error & { code: string };
      error.code = 'ER_PARSE_ERROR';
      throw error;
    },
    async close() {},
  };

  await assert.rejects(
    () => resolveActiveMySqlAccess({ candidate: mysqlWithSchemaError }),
    /SQL syntax/,
  );
});
