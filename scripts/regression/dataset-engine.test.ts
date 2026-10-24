import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DATASET_TOPICS,
  getDatasetReading,
  parseDatasetKey,
  resolveDefaultSqlitePath,
} from '../../lib/ziwei-dataset';

async function main() {
  // 1. Key validation boundaries
  assert.equal(parseDatasetKey('1949-12-31-0-male'), null, 'year < 1950 rejected');
  assert.equal(parseDatasetKey('2027-01-01-0-male'), null, 'year > 2026 rejected');
  assert.equal(parseDatasetKey('1990-06-15-12-male'), null, 'hour > 11 rejected');
  const parsed = parseDatasetKey('1990-6-5-0-female');
  assert.equal(parsed?.k, '1990-06-05-0-female', 'pads month/day');

  const resolvedPath = resolveDefaultSqlitePath();
  const sqliteTestPath = fs.existsSync(resolvedPath)
    ? resolvedPath
    : '/tmp/test_1990_single.sqlite';

  if (!fs.existsSync(sqliteTestPath)) {
    console.log('dataset-engine regression skipped (no local dataset on this runner)');
    return;
  }

  // 2. Non-existent solar date in dataset returns null
  const invalidFeb30 = await getDatasetReading('1990-02-30-0-male', 'sqlite', {
    sqlitePath: sqliteTestPath,
    bypassCache: true,
  });
  assert.equal(invalidFeb30, null, '1990-02-30 must return null');

  // 3. Test SQLite-Zstd (cold + warm) across all 13 topics
  const targetKey = '1990-06-15-5-male';
  const fromSqliteCold = await getDatasetReading(targetKey, 'sqlite', {
    sqlitePath: sqliteTestPath,
    bypassCache: true,
  });
  assert.ok(fromSqliteCold, 'SQLite cold lookup must return record');
  assert.equal(fromSqliteCold._engine.source, 'sqlite-zstd');
  assert.ok(fromSqliteCold._engine.elapsedMs < 250, `Expected fast SQLite cold lookup, got ${fromSqliteCold._engine.elapsedMs}ms`);

  // Populate cache & test warm lookup
  await getDatasetReading(targetKey, 'sqlite', { sqlitePath: sqliteTestPath });
  const fromSqliteWarm = await getDatasetReading('1990-06-18-3-female', 'sqlite', { sqlitePath: sqliteTestPath });
  assert.ok(fromSqliteWarm, 'SQLite warm lookup must return record');
  assert.equal(fromSqliteWarm._engine.cacheHit, true);
  assert.ok(fromSqliteWarm._engine.elapsedMs < 10, `Expected <10ms warm lookup, got ${fromSqliteWarm._engine.elapsedMs}ms`);

  for (const topic of DATASET_TOPICS) {
    assert.ok(fromSqliteCold.c[topic].length > 500, `topic ${topic} should be non-trivial`);
  }

  // 4. If .zst archive is present on host, verify 100% lossless byte-for-byte identity against zst-onfly
  if (fs.existsSync('/opt/fate-data/ziwei-interp-v4/year-1990.jsonl.zst')) {
    const fromZst = await getDatasetReading(targetKey, 'zst-onfly', {
      bypassCache: true,
    });
    assert.ok(fromZst, 'zst-onfly lookup must return record');
    assert.equal(fromZst._engine.source, 'zst-onfly');

    assert.equal(fromSqliteCold.k, fromZst.k);
    assert.equal(fromSqliteCold.ms, fromZst.ms);
    assert.deepEqual(fromSqliteCold.t, fromZst.t, 'topic char counts must match identically');

    for (const topic of DATASET_TOPICS) {
      assert.equal(
        fromSqliteCold.c[topic],
        fromZst.c[topic],
        `topic ${topic} full markdown text must match 100% byte-for-byte`
      );
    }
    console.log(
      `dataset-engine regression passed (sqlite-cold=${fromSqliteCold._engine.elapsedMs}ms, sqlite-warm=${fromSqliteWarm._engine.elapsedMs}ms vs zst-onfly=${fromZst._engine.elapsedMs}ms, 13 topics byte-identical)`
    );
  } else {
    console.log(
      `dataset-engine regression passed (sqlite-cold=${fromSqliteCold._engine.elapsedMs}ms, sqlite-warm=${fromSqliteWarm._engine.elapsedMs}ms, 13 topics verified)`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
