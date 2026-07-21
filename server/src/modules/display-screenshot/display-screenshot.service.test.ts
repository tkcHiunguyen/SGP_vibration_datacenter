import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DisplayScreenshotService } from './display-screenshot.service.js';

test('stores, lists and reloads the latest display screenshot', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'sgp-display-screen-'));
  try {
    const service = new DisplayScreenshotService({ baseDir });
    const clientId = '4b7bf913-6ae4-4bfd-80ed-53248d8ef1e2';
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    await service.store({
      clientId,
      displayName: 'Windows 3840x2160',
      capturedAt: '2026-07-20T10:00:00.000Z',
      contentType: 'image/jpeg',
      buffer: image,
      viewportWidth: 3840,
      viewportHeight: 2160,
      devicePixelRatio: 1,
      pagePath: '/dashboard',
      clientIp: '192.168.1.20',
      userAgent: 'test-browser',
    });

    const listed = await service.listLatest();
    const latest = await service.readLatest(clientId);

    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.viewportWidth, 3840);
    assert.equal(latest?.record.clientIp, '192.168.1.20');
    assert.deepEqual(latest?.buffer, image);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('rejects a non-image display upload', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'sgp-display-screen-'));
  try {
    const service = new DisplayScreenshotService({ baseDir });
    await assert.rejects(
      service.store({
        clientId: '1f8b9b9d-d407-44de-b1e6-fc67d8431521',
        displayName: 'Display',
        capturedAt: new Date().toISOString(),
        contentType: 'text/html',
        buffer: Buffer.from('<html>'),
        viewportWidth: 1920,
        viewportHeight: 1080,
        devicePixelRatio: 1,
        pagePath: '/dashboard',
      }),
      /display_screenshot_content_type_invalid/,
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
