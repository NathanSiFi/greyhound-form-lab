// Collects today's Australian greyhound fields from thedogs.com.au into data/<date>.json.
// Run: node collector/collect.mjs            (today, Melbourne time)
//      DATE=2026-10-19 node collector/collect.mjs
// Zero dependencies — needs Node 18+ for built-in fetch.

import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseRaceLinks, parseRacePage, parseExpertForm, parseDogRuns, classChange } from "./parse.mjs";

const BASE = "https://www.thedogs.com.au";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const KEEP_DAYS = 7;
const CONCURRENCY = 3;
const PAUSE_MS = 350; // be polite to the site

const melbDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(d);
const melbTime = iso => new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DATE = process.env.DATE || melbDate();

let requests = 0, failures = 0;
async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      requests++;
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (GreyhoundFormLab personal form guide)", "Accept": "text/html" } });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
      if (res.status === 403 && i === tries) throw new Error(`403 blocked: ${url}`);
    } catch (e) {
      if (i === tries) { failures++; console.warn(`  ! ${url}: ${e.message}`); return null; }
    }
    await sleep(1000 * i * i);
  }
  failures++; return null;
}

async function pool(items, worker) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) { const i = next++; out[i] = await worker(items[i], i); await sleep(PAUSE_MS); }
  }));
  return out;
}

const dogCache = new Map();
async function dogRuns(dogPath) {
  if (!dogPath) return [];
  if (!dogCache.has(dogPath)) dogCache.set(dogPath, get(BASE + dogPath).then(h => (h ? parseDogRuns(h) : [])));
  return dogCache.get(dogPath);
}

async function collectRace(link) {
  const url = `${BASE}${link.path}?trial=false`;
  const html = await get(url);
  if (!html) return null;
  const race = parseRacePage(html);
  const efHtml = await get(`${BASE}${link.path}/expert-form?trial=false`);
  const ef = efHtml ? parseExpertForm(efHtml) : {};

  const runners = [];
  for (const r of race.runners) {
    const x = ef[r.box] || {};
    const scratched = r.scratched || !!x.scratched;
    const dogPath = x.dogPath || (r.dogId ? `/dogs/${r.dogId}/x` : null);
    const runs = scratched ? [] : await dogRuns(dogPath);
    const recent = runs.length
      ? runs.slice(0, 6).map(v => v.place)
      : (r.last4 || "").split("").reverse().map(c => (/\d/.test(c) ? +c : 0));
    runners.push({
      box: r.box, name: r.name, trainer: r.trainer, scratched,
      recent,
      best: r.bestTd ?? x.best ?? null,
      split: x.bestSplit ?? r.avgSplit ?? null,
      margins: runs.slice(0, 3).map(v => v.margin).filter(v => v != null),
      whelped: x.whelped ?? null,
      cls: runs[0] ? classChange(race.grade, runs[0].grade) : null,
      lastGrade: runs[0]?.grade ?? null,
      tdStarts: (x.td || r.td)?.starts ?? null, tdWins: (x.td || r.td)?.wins ?? null, tdPlaces: (x.td || r.td)?.places ?? null,
      starts: x.career?.starts ?? null, wins: x.career?.wins ?? null, places: x.career?.places ?? null,
      lastDate: runs[0]?.date ?? r.lastDate ?? null,
      weight: runs[0]?.weight ?? null, lastWeight: runs[1]?.weight ?? null
    });
  }
  return {
    id: `${DATE}_${link.trackSlug}_${String(link.raceNo).padStart(2, "0")}`,
    date: DATE, track: race.track || link.trackSlug, state: race.state, raceNo: link.raceNo,
    start: race.startIso, time: race.startIso ? melbTime(race.startIso) : "",
    distance: race.distance, grade: race.grade, name: race.raceName, source: url, runners
  };
}

async function main() {
  console.log(`Collecting ${DATE}`);
  const index = await get(`${BASE}/racing`);
  if (!index) throw new Error("Couldn't load the meetings page — the site may be blocking this runner.");
  const links = parseRaceLinks(index, DATE);
  console.log(`  ${links.length} races found`);

  await mkdir(DATA, { recursive: true });
  const file = path.join(DATA, `${DATE}.json`);
  let previous = {};
  try { for (const r of JSON.parse(await readFile(file, "utf8")).races) previous[r.id] = r; } catch {}

  const races = (await pool(links, async (l, i) => {
    const r = await collectRace(l).catch(e => { console.warn(`  ! ${l.path}: ${e.message}`); return null; });
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${links.length}`);
    return r;
  }));
  // keep yesterday-run data for any race that failed this time
  const final = links.map((l, i) => races[i] || previous[`${DATE}_${l.trackSlug}_${String(l.raceNo).padStart(2, "0")}`]).filter(Boolean)
    .sort((a, b) => (a.start || "").localeCompare(b.start || "") || a.raceNo - b.raceNo);

  if (!final.length) throw new Error("No races collected.");
  const updatedAt = new Date().toISOString();
  await writeFile(file, JSON.stringify({ date: DATE, updatedAt, races: final }));

  // index + housekeeping
  const cutoff = melbDate(new Date(Date.now() - KEEP_DAYS * 864e5));
  const dates = [];
  for (const f of await readdir(DATA)) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    if (m[1] < cutoff) await unlink(path.join(DATA, f)); else dates.push(m[1]);
  }
  dates.sort().reverse();
  await writeFile(path.join(DATA, "index.json"), JSON.stringify({ updatedAt, dates }));
  console.log(`Done: ${final.length} races, ${dogCache.size} dogs, ${requests} requests, ${failures} failed.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
