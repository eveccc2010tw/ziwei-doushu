#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";
import zlib from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";

const TOPICS = [
  "overview", "personality", "love", "career", "wealth", "health",
  "family", "children", "move", "friends", "home", "spirit", "parents"
];
const SLOTS_PER_MONTH = 31 * 24; // 744

async function processYearFile(dataDir, year, zstdLevel = 9) {
  const zstPath = path.join(dataDir, `year-${year}.jsonl.zst`);
  const jsonlPath = path.join(dataDir, `year-${year}.jsonl`);

  let inputStream;
  let proc = null;
  if (fs.existsSync(zstPath)) {
    proc = spawn("zstd", ["-d", "--long=27", "-c", zstPath], { stdio: ["ignore", "pipe", "inherit"] });
    inputStream = proc.stdout;
  } else if (fs.existsSync(jsonlPath)) {
    inputStream = fs.createReadStream(jsonlPath);
  } else {
    throw new Error(`Missing data file for year ${year}`);
  }

  const lineToId = new Map();
  const idToLine = [];
  const rawCharts = [];

  const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const obj = JSON.parse(line);
    const topicLines = new Array(TOPICS.length);
    for (let t = 0; t < TOPICS.length; t++) {
      const text = obj.c[TOPICS[t]] || "";
      const lines = text.split("\n");
      const ids = new Array(lines.length);
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        let id = lineToId.get(l);
        if (id === undefined) {
          id = idToLine.length;
          lineToId.set(l, id);
          idToLine.push(l);
        }
        ids[i] = id;
      }
      topicLines[t] = ids;
    }
    rawCharts.push({
      m: obj.m,
      d: obj.d,
      h: obj.h,
      g: obj.g,
      ms: obj.ms,
      t: obj.t,
      topicLines,
    });
  }

  if (proc) {
    await new Promise((resolve, reject) => {
      proc.on("close", code => code === 0 ? resolve() : reject(new Error(`zstd exited ${code}`)));
    });
  }

  const idBytes = idToLine.length <= 65535 ? 2 : 4;
  const byMonth = new Map();
  const monthCounts = new Map();

  for (const c of rawCharts) {
    const monthKey = `${year}-${String(c.m).padStart(2, "0")}`;
    if (!byMonth.has(monthKey)) {
      byMonth.set(monthKey, new Array(SLOTS_PER_MONTH).fill(null));
      monthCounts.set(monthKey, 0);
    }
    let totalIds = 0;
    for (let t = 0; t < TOPICS.length; t++) totalIds += 1 + c.topicLines[t].length;
    const chartBin = Buffer.allocUnsafe(totalIds * idBytes);
    let offset = 0;
    for (let t = 0; t < TOPICS.length; t++) {
      const ids = c.topicLines[t];
      if (idBytes === 2) {
        chartBin.writeUInt16LE(ids.length, offset);
        offset += 2;
        for (let i = 0; i < ids.length; i++) {
          chartBin.writeUInt16LE(ids[i], offset);
          offset += 2;
        }
      } else {
        chartBin.writeUInt32LE(ids.length, offset);
        offset += 4;
        for (let i = 0; i < ids.length; i++) {
          chartBin.writeUInt32LE(ids[i], offset);
          offset += 4;
        }
      }
    }

    const metaJson = Buffer.from(JSON.stringify({ ms: c.ms, t: c.t }), "utf8");
    const header = Buffer.allocUnsafe(7);
    header.writeUInt8(idBytes, 0);
    header.writeUInt16LE(metaJson.length, 1);
    header.writeUInt32LE(chartBin.length, 3);
    const fullRecord = Buffer.concat([header, metaJson, chartBin]);

    const slot = (c.d - 1) * 24 + c.h * 2 + (c.g === "female" ? 1 : 0);
    byMonth.get(monthKey)[slot] = fullRecord;
    monthCounts.set(monthKey, monthCounts.get(monthKey) + 1);
  }

  const zstdParams = { params: { [zlib.constants.ZSTD_c_compressionLevel]: zstdLevel } };
  const dictZst = zlib.zstdCompressSync(Buffer.from(idToLine.join("\n"), "utf8"), zstdParams);

  const months = [];
  for (const [monthKey, slots] of byMonth.entries()) {
    const offsetsBuf = Buffer.allocUnsafe((SLOTS_PER_MONTH + 1) * 4);
    let cur = 0;
    const bufs = [offsetsBuf];
    for (let i = 0; i < SLOTS_PER_MONTH; i++) {
      offsetsBuf.writeUInt32LE(cur, i * 4);
      const b = slots[i];
      if (b && b.length > 0) {
        bufs.push(b);
        cur += b.length;
      }
    }
    offsetsBuf.writeUInt32LE(cur, SLOTS_PER_MONTH * 4);
    const rawMonth = Buffer.concat(bufs);
    const blockZst = zlib.zstdCompressSync(rawMonth, zstdParams);
    months.push({
      month: monthKey,
      chartCount: monthCounts.get(monthKey),
      blockZst,
    });
  }

  return {
    year,
    lineCount: idToLine.length,
    chartCount: rawCharts.length,
    dictZst,
    months,
  };
}

if (!isMainThread) {
  const { dataDir, years, zstdLevel } = workerData;
  (async () => {
    for (const year of years) {
      const t0 = performance.now();
      const res = await processYearFile(dataDir, year, zstdLevel);
      const elapsedSec = ((performance.now() - t0) / 1000).toFixed(2);
      parentPort.postMessage({ type: "year_done", res, elapsedSec });
    }
    parentPort.postMessage({ type: "worker_done" });
  })().catch(err => {
    parentPort.postMessage({ type: "error", error: err.message || String(err) });
    process.exit(1);
  });
} else {
  const args = process.argv.slice(2);
  const dataDir = process.env.ZIWEI_DATA_DIR || "/opt/fate-data/ziwei-interp-v4";
  const outPath = args[0] || path.join(dataDir, "ziwei-v4.sqlite");
  const startYear = Number(args[1] || 1950);
  const endYear = Number(args[2] || 2026);
  const concurrency = Number(args[3] || 4);
  const zstdLevel = Number(args[4] || 9);

  const allYears = [];
  for (let y = startYear; y <= endYear; y++) allYears.push(y);

  console.log(`Building ${outPath} for years ${startYear}..${endYear} (${allYears.length} years, workers=${concurrency}, zstd=${zstdLevel})`);
  const tmpPath = `${outPath}.tmp`;
  try { fs.unlinkSync(tmpPath); } catch {}

  const db = new DatabaseSync(tmpPath);
  db.exec(`
    PRAGMA page_size = 4096;
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE year_dicts (year INTEGER PRIMARY KEY, line_count INTEGER NOT NULL, dict_zst BLOB NOT NULL);
    CREATE TABLE month_blocks (month TEXT PRIMARY KEY, year INTEGER NOT NULL, chart_count INTEGER NOT NULL, block_zst BLOB NOT NULL);
  `);

  const insDict = db.prepare("INSERT INTO year_dicts VALUES (?, ?, ?)");
  const insMonth = db.prepare("INSERT INTO month_blocks VALUES (?, ?, ?, ?)");

  const buckets = Array.from({ length: Math.min(concurrency, allYears.length) }, () => []);
  allYears.forEach((y, i) => buckets[i % buckets.length].push(y));

  const tStart = performance.now();
  let completedYears = 0;
  let totalCharts = 0;
  let totalCompressedBytes = 0;

  await new Promise((resolve, reject) => {
    let activeWorkers = buckets.length;
    for (const bucket of buckets) {
      const w = new Worker(new URL(import.meta.url), {
        workerData: { dataDir, years: bucket, zstdLevel },
      });
      w.on("message", msg => {
        if (msg.type === "year_done") {
          const { res, elapsedSec } = msg;
          db.exec("BEGIN");
          insDict.run(res.year, res.lineCount, res.dictZst);
          let yBytes = res.dictZst.length;
          for (const m of res.months) {
            insMonth.run(m.month, res.year, m.chartCount, m.blockZst);
            yBytes += m.blockZst.length;
          }
          db.exec("COMMIT");
          completedYears++;
          totalCharts += res.chartCount;
          totalCompressedBytes += yBytes;
          console.log(`[${completedYears}/${allYears.length}] Year ${res.year}: ${res.chartCount} charts, ${res.lineCount} unique lines -> ${(yBytes / 1e6).toFixed(2)} MB (${elapsedSec}s)`);
        } else if (msg.type === "worker_done") {
          activeWorkers--;
          if (activeWorkers === 0) resolve();
        } else if (msg.type === "error") {
          reject(new Error(msg.error));
        }
      });
      w.on("error", reject);
    }
  });

  db.prepare("INSERT INTO meta VALUES (?, ?)").run("version", "v4.0-13d-sqlite-v1");
  db.prepare("INSERT INTO meta VALUES (?, ?)").run("totalCharts", String(totalCharts));
  db.prepare("INSERT INTO meta VALUES (?, ?)").run("years", `${startYear}-${endYear}`);
  db.exec("VACUUM;");
  db.close();
  fs.renameSync(tmpPath, outPath);

  const totalSec = ((performance.now() - tStart) / 1000).toFixed(1);
  const fileSizeMB = (fs.statSync(outPath).size / 1e6).toFixed(2);
  console.log(`DONE! ${totalCharts} charts in ${fileSizeMB} MB (${totalSec}s)`);
}
