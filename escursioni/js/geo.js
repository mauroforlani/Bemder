// Funzioni geometriche pure (nessuna dipendenza dal browser): testabili con `npm test`.
// Coordinate sempre nel formato [lat, lon]; distanze in metri.

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Web Mercator (EPSG:3857), usato dall'API di Camptocamp. */
const RM = 6378137;
export function toMerc(lat, lon) {
  return [RM * rad(lon), RM * Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2))];
}
export function fromMerc(x, y) {
  return [((2 * Math.atan(Math.exp(y / RM)) - Math.PI / 2) * 180) / Math.PI, ((x / RM) * 180) / Math.PI];
}

export function cumDist(pts) {
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + haversine(pts[i - 1], pts[i]));
  return d;
}

export function lineLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]);
  return d;
}

/** Ricampiona una polilinea in n punti equidistanti. Ritorna {pts, d} (d = progressiva in m). */
export function resample(pts, n = 100) {
  const cd = cumDist(pts);
  const total = cd[cd.length - 1];
  if (pts.length < 2 || total === 0) return { pts: pts.slice(), d: cd };
  n = Math.max(2, n);
  const out = [];
  const dd = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < cd.length - 2 && cd[j + 1] < target) j++;
    const seg = cd[j + 1] - cd[j];
    const t = seg > 0 ? Math.min(1, Math.max(0, (target - cd[j]) / seg)) : 0;
    out.push([
      pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t,
      pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t,
    ]);
    dd.push(target);
  }
  return { pts: out, d: dd };
}

/** Unisce spezzate i cui estremi distano meno di `tol` metri (invertendole se serve). */
export function stitch(lines, tol = 25) {
  const remaining = lines.filter((l) => l && l.length >= 2).map((l) => l.slice());
  const chains = [];
  while (remaining.length) {
    let chain = remaining.shift();
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < remaining.length; i++) {
        const w = remaining[i];
        const start = chain[0];
        const end = chain[chain.length - 1];
        if (haversine(end, w[0]) <= tol) chain = chain.concat(w);
        else if (haversine(end, w[w.length - 1]) <= tol) chain = chain.concat(w.slice().reverse());
        else if (haversine(start, w[w.length - 1]) <= tol) chain = w.concat(chain);
        else if (haversine(start, w[0]) <= tol) chain = w.slice().reverse().concat(chain);
        else continue;
        remaining.splice(i, 1);
        extended = true;
        break;
      }
    }
    chains.push(chain);
  }
  return chains;
}

/** Ricostruisce il tracciato di una relazione OSM a partire dalle sue way (spesso disordinate). */
export function stitchWays(ways) {
  let chains = stitch(ways, 25);
  chains = stitch(chains, 300); // colma piccoli buchi nella mappatura
  return chains
    .map((c) => ({ c, len: lineLength(c) }))
    .sort((a, b) => b.len - a.len)
    .map((x) => x.c);
}

/** Riduce il numero di punti mantenendo primo e ultimo. */
export function decimate(pts, max = 500) {
  if (pts.length <= max) return pts.slice();
  const step = Math.ceil(pts.length / max);
  const out = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

export function nearestIndex(pts, p) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = haversine(pts[i], p);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return { i: best, dist: bd };
}

/** Dislivello positivo/negativo con isteresi (filtra il rumore del modello digitale). */
export function climb(e, th = 8) {
  let up = 0;
  let down = 0;
  if (!e.length) return { up, down };
  let ref = e[0];
  for (const x of e) {
    const diff = x - ref;
    if (diff >= th) {
      up += diff;
      ref = x;
    } else if (diff <= -th) {
      down -= diff;
      ref = x;
    }
  }
  return { up: Math.round(up), down: Math.round(down) };
}

/** Statistiche di un tratto di profilo tra gli indici i0 e i1 (inclusi). */
export function profileStats(d, e, i0 = 0, i1 = e.length - 1) {
  const seg = e.slice(i0, i1 + 1);
  const { up, down } = climb(seg);
  const km = (d[i1] - d[i0]) / 1000;
  return {
    km: Math.round(km * 10) / 10,
    up,
    down,
    min: Math.round(Math.min(...seg)),
    max: Math.round(Math.max(...seg)),
    hours: hikingTime(km, up, down),
  };
}

/** Tempo di percorrenza (ore) — metodo DIN 33466 / CAI: 4 km/h in piano, 300 m/h in salita, 500 m/h in discesa. */
export function hikingTime(km, up, down) {
  const h = km / 4;
  const v = up / 300 + down / 500;
  return Math.round((Math.max(h, v) + Math.min(h, v) / 2) * 10) / 10;
}

export function centroid(items) {
  const n = items.length || 1;
  return [items.reduce((s, i) => s + i.lat, 0) / n, items.reduce((s, i) => s + i.lon, 0) / n];
}

/**
 * Raggruppa i punti in k gruppi geograficamente compatti con capienza massima `cap`
 * (k-means con inizializzazione maximin deterministica + assegnazione a capienza vincolata).
 * `items` deve essere ordinato per importanza: il primo diventa il primo centro.
 */
export function clusterBalanced(items, k, cap) {
  const n = items.length;
  if (k <= 1 || n <= 1) return [items.slice()];
  k = Math.min(k, n);
  const P = items.map((it) => [it.lat, it.lon]);
  const cents = [P[0].slice()];
  while (cents.length < k) {
    let best = -1;
    let bd = -1;
    P.forEach((p, i) => {
      const d = Math.min(...cents.map((c) => haversine(p, c)));
      if (d > bd) {
        bd = d;
        best = i;
      }
    });
    cents.push(P[best].slice());
  }
  const assign = new Array(n).fill(-1);
  for (let it = 0; it < 50; it++) {
    let changed = false;
    P.forEach((p, i) => {
      let b = 0;
      let bd = Infinity;
      cents.forEach((c, j) => {
        const d = haversine(p, c);
        if (d < bd) {
          bd = d;
          b = j;
        }
      });
      if (assign[i] !== b) {
        assign[i] = b;
        changed = true;
      }
    });
    for (let j = 0; j < k; j++) {
      const m = P.filter((_, i) => assign[i] === j);
      if (m.length) cents[j] = [m.reduce((s, p) => s + p[0], 0) / m.length, m.reduce((s, p) => s + p[1], 0) / m.length];
    }
    if (!changed) break;
  }
  cap = Math.max(cap, Math.ceil(n / k));
  const pairs = [];
  P.forEach((p, i) => cents.forEach((c, j) => pairs.push([haversine(p, c), i, j])));
  pairs.sort((a, b) => a[0] - b[0]);
  const done = new Array(n).fill(false);
  const cnt = new Array(k).fill(0);
  const groups = Array.from({ length: k }, () => []);
  for (const [, i, j] of pairs) {
    if (done[i] || cnt[j] >= cap) continue;
    done[i] = true;
    cnt[j]++;
    groups[j].push(items[i]);
  }
  return groups.filter((g) => g.length);
}

function pathLen(route) {
  let d = 0;
  for (let i = 1; i < route.length; i++) d += haversine([route[i - 1].lat, route[i - 1].lon], [route[i].lat, route[i].lon]);
  return d;
}

/** Ordina le tappe (nearest-neighbour + 2-opt) partendo dalla più vicina a `start` [lat,lon]. */
export function orderRoute(items, start) {
  if (items.length <= 1) return items.slice();
  const left = items.slice();
  let idx = 0;
  if (start) idx = nearestIndex(left.map((i) => [i.lat, i.lon]), start).i;
  const route = [left.splice(idx, 1)[0]];
  while (left.length) {
    const last = route[route.length - 1];
    const { i } = nearestIndex(left.map((x) => [x.lat, x.lon]), [last.lat, last.lon]);
    route.push(left.splice(i, 1)[0]);
  }
  let improved = true;
  let best = pathLen(route);
  let r = route;
  while (improved) {
    improved = false;
    for (let i = 1; i < r.length - 1; i++) {
      for (let j = i + 1; j < r.length; j++) {
        const cand = r.slice(0, i).concat(r.slice(i, j + 1).reverse(), r.slice(j + 1));
        const l = pathLen(cand);
        if (l + 1 < best) {
          r = cand;
          best = l;
          improved = true;
        }
      }
    }
  }
  return r;
}
