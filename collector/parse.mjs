// Parsers for thedogs.com.au pages. Zero dependencies: the site's HTML is server-rendered
// with stable BEM class names, so targeted regexes over each block are enough.

const decode = s => String(s ?? "")
  .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const text = html => decode(String(html ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const num = v => { const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; };
const pos = s => { const m = String(s ?? "").match(/^(\d+)/); return m ? +m[1] : 0; }; // "3rd/6" -> 3, F/DNF -> 0

// innerHTML of the first element with this class (handles nesting of the same tag)
function block(html, cls, from = 0) {
  const esc = cls.replace(/[-_]/g, m => "\\" + m);
  const re = new RegExp(`<([\\w-]+)[^>]*\\bclass="(?:[^"]*\\s)?${esc}(?:\\s[^"]*)?"[^>]*>`, "g");
  re.lastIndex = from;
  const m = re.exec(html);
  if (!m) return null;
  const tag = m[1], start = m.index + m[0].length;
  const open = new RegExp(`<${tag}\\b`, "g"), close = new RegExp(`</${tag}>`, "g");
  let depth = 1, i = start;
  while (depth > 0) {
    open.lastIndex = i; close.lastIndex = i;
    const o = open.exec(html), c = close.exec(html);
    if (!c) return { inner: html.slice(start), end: html.length, open: m[0] };
    if (o && o.index < c.index) { depth++; i = o.index + 1; }
    else { depth--; i = c.index + c[0].length; if (depth === 0) return { inner: html.slice(start, c.index), end: i, open: m[0] }; }
  }
}
function blocks(html, cls) {
  const out = []; let from = 0, b;
  while ((b = block(html, cls, from))) { out.push(b); from = b.end; }
  return out;
}
const inner = (html, cls) => block(html, cls)?.inner ?? null;
const rug = html => { const m = String(html ?? "").match(/name="rug_(\d+)"/); return m ? +m[1] : null; };
const rec = s => { const m = String(s ?? "").match(/(\d+)\s*:\s*(\d+)-(\d+)-(\d+)/); return m ? { starts: +m[1], wins: +m[2], places: +m[3] + +m[4] } : null; };
const isoFromTs = ts => ts ? new Date(+ts * 1000).toISOString().slice(0, 10) : null;

/* ---------- index page: today's race links ---------- */
export function parseRaceLinks(html, date) {
  const out = new Map();
  const re = new RegExp(`href="(/racing/([a-z0-9-]+)/${date}/(\\d+)/([a-z0-9-]+))(?:/expert-form)?(?:\\?[^"]*)?"`, "g");
  let m;
  while ((m = re.exec(html))) {
    const key = `${m[2]}-${m[3]}`;
    if (!out.has(key)) out.set(key, { path: m[1], trackSlug: m[2], raceNo: +m[3] });
  }
  return [...out.values()];
}

/* ---------- race page ---------- */
export function parseRacePage(html) {
  const venue = inner(html, "meeting-header__venue");
  const track = text(inner(venue || "", "meeting-header__venue__name"));
  const state = text(inner(venue || "", "meeting-header__venue__state"));
  const header = inner(html, "race-header") || "";
  const startIso = (header.match(/data-race-box="([^"]+)"/) || [])[1] || null;
  const gradeDist = text(inner(header, "race-header__info__grade"));
  const dm = gradeDist.match(/(\d{3,4})\s*m\b/);
  const distance = dm ? dm[1] + "m" : "";
  const grade = gradeDist.replace(/\s*\d{3,4}\s*m\b/, "").trim();
  const raceName = text(inner(header, "race-header__info__name"));

  const table = inner(html, "race-runners") || "";
  const runners = [];
  for (const tr of table.split(/<tr\b/).slice(1)) {
    if (!/class="[^"]*\brace-runner\b/.test(tr.slice(0, 200))) continue;
    const cell = c => inner("<tr" + tr, c);
    const nameCell = cell("race-runners__name__dog") || "";
    const name = text(nameCell.replace(/<span[\s\S]*?<\/span>/g, ""));
    const lastStart = cell("race-runners__last-start") || "";
    const lsDate = (lastStart.match(/\/racing\/[a-z0-9-]+\/(\d{4}-\d{2}-\d{2})\//) || [])[1] || null;
    const sec = text(cell("race-runners__speedmap"));
    runners.push({
      box: rug(cell("race-runners__box")),
      dogId: (tr.match(/data-dog-id="(\d+)"/) || [])[1] || null,
      dogPath: null,
      name,
      trainer: text(cell("race-runners__trainer")),
      last4: text(cell("race-runners__last-four")),
      td: rec(text(cell("race-runners__track-dist"))),
      avgSplit: /N\/A/.test(sec) ? null : num(sec),
      bestTd: (() => { const t = text(inner(nameCell, "race-runners__name__time")); return /NBT/i.test(t) ? null : num(t); })(),
      lastDate: lsDate,
      scratched: /race-runner--scratched/.test(tr.slice(0, 200)) || /\bSCR\b/.test(text(cell("race-runners__odds")))
    });
  }
  return { track, state, startIso, distance, grade, raceName, runners };
}

/* ---------- expert form page ---------- */
export function parseExpertForm(html) {
  const out = {};
  for (const sec of blocks(html, "content-section")) {
    const s = sec.inner;
    if (!/expert-form-dog--details/.test(s)) continue;
    const box = rug(inner(s, "run-box"));
    const dogPath = (s.match(/href="(\/dogs\/\d+\/[^"]+)"/) || [])[1] || null;
    const dogId = dogPath ? dogPath.split("/")[2] : null;
    const cells = blocks(s, "expert-form-cell").map(c => c.inner);
    const cellBy = h => cells.find(c => new RegExp(`cell--heading">\\s*${h}`).test(c)) || "";
    const greyhound = cellBy("GREYHOUND");
    const whelped = isoFromTs((greyhound.match(/data-timestamp="(\d+)"/) || [])[1]);
    const career = cellBy("CAREER");
    const careerRec = rec((career.match(/Career:<\/span>\s*<span>([^<]+)/) || [])[1]);
    const tdRec = rec((career.match(/TD:<\/span>\s*<span>([^<]+)/) || [])[1]);
    const td = cellBy("TRACK\\/DIST");
    const tdVals = [...td.matchAll(/track__distance">\s*<span>([^<]*)<\/span>/g)].map(m => num(m[1]));
    const zero = v => (v == null || v === 0 ? null : v);
    out[box] = { box, dogId, dogPath, whelped, career: careerRec, td: tdRec, best: zero(tdVals[0]), bestSplit: zero(tdVals[1]),
      scratched: /expert-form-runner__scratched/.test(sec.open) || /expert-form-runner__scratching/.test(s) };
  }
  return out;
}

/* ---------- dog page: recent runs ---------- */
export function parseDogRuns(html) {
  const table = inner(html, "show-runner-form") || "";
  const body = (table.split(/<tbody>/)[1] || "").split(/<\/tbody>/)[0];
  const runs = [];
  for (const tr of body.split(/<tr\b/).slice(1)) {
    const head = tr.slice(0, 120);
    if (/runner-form__show-more|runner-form__last-win/.test(head)) break; // stop at the "Last Win" repeat
    const tds = [...("<tr" + tr).matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    if (tds.length < 14) continue;
    const place = text(tds[0]);
    const date = (tds[4].match(/\/racing\/[a-z0-9-]+\/(\d{4}-\d{2}-\d{2})\//) || [])[1] || null;
    const p = pos(place);
    const mgn = num(text(tds[11]));
    runs.push({
      place: p, field: num((place.split("/")[1]) || ""), weight: num(text(tds[2])), distance: num(text(tds[3])),
      date, track: text(tds[5]), grade: text(tds[6]), time: num(text(tds[7])), split: num(text(tds[10])),
      margin: p === 1 ? 0 : mgn
    });
  }
  return runs;
}

/* ---------- grade difficulty (higher = harder) ---------- */
export function gradeLevel(g) {
  const s = String(g || "").toLowerCase();
  if (!s) return null;
  if (/group\s*1|g1\b/.test(s)) return 11;
  if (/group|listed|feature/.test(s)) return 10;
  if (/free\s*for\s*all|\bffa\b|open\b|invitation/.test(s)) return 9;
  if (/masters|veteran/.test(s)) return 4;
  if (/maiden/.test(s)) return 0;
  if (/novice/.test(s)) return 1;
  const mixed = s.match(/mixed\s*(\d)\s*\/\s*(\d)/);
  if (mixed) return 8 - (+mixed[1] + +mixed[2]) / 2;
  const gr = s.match(/(?:grade\s*(\d))|(?:(\d)(?:st|nd|rd|th)\s*grade)/);
  if (gr) return 8 - +(gr[1] || gr[2]);
  const wins = s.match(/(\d)\s*-\s*(\d)\s*wins?/);
  if (wins) return 0.5 + (+wins[1] + +wins[2]) / 2; // e.g. 1-4 wins ≈ grade 5
  if (/restricted\s*win/.test(s)) return 2;
  const bare = s.match(/^\s*[a-z]{0,2}\s*(\d)\s*(?:heat|final|t\d)?\s*$/); // QLD style "5", "P5", "M5"
  if (bare) return 8 - +bare[1];
  return null;
}
export function classChange(today, last) {
  const a = gradeLevel(today), b = gradeLevel(last);
  if (a == null || b == null) return null;
  const d = a - b;
  return Math.abs(d) < 0.5 ? 0 : d > 0 ? 1 : -1;
}
