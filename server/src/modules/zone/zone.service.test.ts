import assert from 'node:assert/strict';
import test from 'node:test';
import { ZoneService } from './zone.service.js';

test('zone CRUD supports server-side paging, filtering and sorting', async () => {
  const service = new ZoneService(null);

  const createdB = await service.create({
    name: 'Khu B',
    description: 'B line',
  });
  const createdA = await service.create({
    name: 'Khu A',
  });
  await service.create({
    name: 'Khu C',
    description: 'C line',
  });

  const page1 = await service.listPage({
    sortBy: 'name-asc',
    page: 1,
    pageSize: 2,
  });
  assert.equal(page1.total, 3);
  assert.equal(page1.totalPages, 2);
  assert.deepEqual(
    page1.items.map((item) => item.name),
    ['Khu A', 'Khu B'],
  );

  const withDescription = await service.listPage({
    descriptionFilter: 'with-description',
    sortBy: 'name-asc',
    page: 1,
    pageSize: 10,
  });
  assert.equal(withDescription.total, 2);
  assert.deepEqual(
    withDescription.items.map((item) => item.name),
    ['Khu B', 'Khu C'],
  );

  const updated = await service.update(createdB.id, {
    name: 'Khu B Updated',
    description: null,
  });
  assert.ok(updated);
  assert.equal(updated?.name, 'Khu B Updated');
  assert.equal(updated?.description, undefined);

  const removed = await service.remove(createdA.id);
  assert.equal(removed, true);
  const fetchedRemoved = await service.get(createdA.id);
  assert.equal(fetchedRemoved, null);

  const finalPage = await service.listPage({
    sortBy: 'code-asc',
    page: 1,
    pageSize: 10,
  });
  assert.equal(finalPage.total, 2);
});

test('zone summary returns total, described count and latest update', async () => {
  const service = new ZoneService(null);

  await service.create({
    name: 'North',
    description: 'North wing',
  });
  await service.create({
    name: 'South',
  });

  const summary = await service.summary();
  assert.equal(summary.total, 2);
  assert.equal(summary.withDescription, 1);
  assert.equal(summary.updatedToday, 2);
  assert.ok(summary.latestUpdatedAt);
});
