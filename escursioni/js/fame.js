// Notorietà di cime, laghi, rifugi e percorsi: visite alle pagine Wikipedia negli ultimi 30 giorni.
// Gli oggetti OSM hanno spesso solo il tag wikidata: da lì si ricava la pagina Wikipedia (it > de > en).
import { fetchJSON } from './api.js';

const WD = 'https://www.wikidata.org/w/api.php';
const LANGS = ['it', 'de', 'en', 'fr'];

async function sitelinks(qids) {
  const out = {};
  for (let i = 0; i < qids.length; i += 50) {
    const ids = qids.slice(i, i + 50).join('|');
    try {
      const d = await fetchJSON(`${WD}?action=wbgetentities&format=json&origin=*&props=sitelinks&sitefilter=${LANGS.map((l) => l + 'wiki').join('|')}&ids=${ids}`);
      for (const [q, ent] of Object.entries(d.entities || {})) {
        const sl = ent.sitelinks || {};
        const lang = LANGS.find((l) => sl[l + 'wiki']);
        if (lang) out[q] = { lang, title: sl[lang + 'wiki'].title };
      }
    } catch (e) {
      console.warn('Wikidata', e);
    }
  }
  return out;
}

async function pageviews(lang, titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    let extra = '';
    for (let guard = 0; guard < 4; guard++) {
      try {
        const d = await fetchJSON(
          `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageviews&pvipdays=30` +
            `&titles=${encodeURIComponent(chunk.join('|'))}${extra}`,
        );
        const back = {};
        (d.query?.normalized || []).forEach((n) => (back[n.to] = n.from));
        const redir = {};
        (d.query?.redirects || []).forEach((r) => (redir[r.to] = r.from));
        for (const p of Object.values(d.query?.pages || {})) {
          if (!p.pageviews) continue;
          let t = p.title;
          if (redir[t]) t = redir[t];
          if (back[t]) t = back[t];
          const v = Object.values(p.pageviews).reduce((a, b) => a + (b || 0), 0);
          out[t] = Math.max(out[t] || 0, v);
          out[p.title] = Math.max(out[p.title] || 0, v);
        }
        if (!d.continue?.pvipcontinue) break;
        extra = `&pvipcontinue=${encodeURIComponent(d.continue.pvipcontinue)}&continue=${encodeURIComponent(d.continue.continue || '')}`;
      } catch (e) {
        console.warn('Wikipedia', e);
        break;
      }
    }
  }
  return out;
}

/**
 * Aggiunge a ogni oggetto { tags } i campi `views` (visite/30 gg) e `wikiUrl`.
 * Limite di sicurezza sul numero di oggetti interrogati: i più "promettenti" prima.
 */
export async function addFame(items, max = 400) {
  const withWiki = items.filter((x) => x.tags?.wikipedia || x.tags?.wikidata).slice(0, max);
  const need = withWiki.filter((x) => !/^[a-z-]{2,12}:.+/.test(x.tags.wikipedia || '') && x.tags.wikidata);
  const sl = await sitelinks([...new Set(need.map((x) => x.tags.wikidata))]);
  const byLang = {};
  for (const x of withWiki) {
    const m = /^([a-z-]{2,12}):(.+)$/.exec(x.tags.wikipedia || '');
    const ref = m ? { lang: m[1], title: m[2] } : sl[x.tags.wikidata];
    if (!ref) continue;
    x._w = ref;
    (byLang[ref.lang] ||= new Set()).add(ref.title);
  }
  const views = {};
  await Promise.all(Object.entries(byLang).map(async ([l, set]) => (views[l] = await pageviews(l, [...set]))));
  for (const x of withWiki) {
    if (!x._w) continue;
    const v = views[x._w.lang]?.[x._w.title];
    x.views = v || 0;
    x.wikiUrl = `https://${x._w.lang}.wikipedia.org/wiki/${encodeURIComponent(x._w.title.replace(/ /g, '_'))}`;
    delete x._w;
  }
  return items;
}

/** Punteggio di notorietà 0–5 (logaritmico: 100 visite/mese ≈ 2, 10 000 ≈ 4). */
export function fameScore(x) {
  if (x.views) return Math.min(5, Math.log10(1 + x.views));
  if (x.tags?.wikidata || x.tags?.wikipedia) return 1;
  return 0;
}
