// providers/animeav1.js — AnimeAV1 source for Zangetsu (animeav1.com)
//
// Endpoints:
//   /catalogo?search=&category=&genre=&page=  -> grilla de cards
//   /media/<slug>                             -> detalle + metadata + episodesCount
//   /media/<slug>/<num>                       -> página del episodio (embeds SUB/DUB)
//
// La metadata y la lista de episodios viven dentro del HTML, en el <script>
// final con `kit.start(app, element, {...})`. Los embeds solo están en la
// página del episodio, en la propiedad `embeds:{SUB:[...],DUB:[...]}` del mismo
// script.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'animeav1';

var SITE = 'https://animeav1.com';
var CDN = 'https://cdn.animeav1.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeAV1', lang: 'es', baseUrl: SITE,
    logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.1' };
}

function _mode(opts) { return (opts && opts.category === 'dub') ? 'dub' : 'sub'; }

function _get(url, ref) {
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Referer': ref || SITE + '/'
    }
  }).then(function (r) { return r.body || ''; })
    .catch(function () { return ''; });
}

function _text(s) {
  return htmlText(String(s || '').replace(/<[^>]*>/g, ''))
    .replace(/^\s+|\s+$/g, '');
}

// ── Cards ──────────────────────────────────────────────────────────────────
// Estructura por card:
//   <article>
//     <a href="/media/<slug>">
//       <figure><img src="..."></figure>
//       <header><h3>Título</h3></header>
//     </a>
//   </article>
function _cards(seg) {
  var out = [], seen = {};
  var chunks = String(seg || '').split(/<article\b[\s>]/i);
  for (var i = 1; i < chunks.length; i++) {
    var c = chunks[i];
    var hrefM = c.match(/href="\/media\/([^"?#]+)/);
    if (!hrefM) continue;
    var slug = hrefM[1];
    if (seen[slug]) continue;
    var imgM = c.match(/<img\b[^>]*src="([^"]+)"/i);
    var titleM = c.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
              || c.match(/alt="([^"]+)"/i);
    if (!titleM) continue;
    seen[slug] = 1;
    out.push({
      id: slug,
      title: _text(titleM[1]),
      englishTitle: _text(titleM[1]),
      cover: imgM ? imgM[1] : null,
      url: slug,
      type: 'anime',
      sourceId: SOURCE_ID,
      subCount: 0, dubCount: 0
    });
  }
  return out;
}

// ── Search ─────────────────────────────────────────────────────────────────
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (q.length < 1) return Promise.resolve([]);
  var p = (page && page > 1) ? page : 1;
  var url = SITE + '/catalogo?search=' + encodeURIComponent(q)
    + '&category=tv-anime&category=ova&category=especial';
  if (p > 1) url += '&page=' + p;
  return _get(url, SITE + '/').then(_cards).catch(function () { return []; });
}

// ── Home ───────────────────────────────────────────────────────────────────
function getHome(opts) {
  return _get(SITE + '/catalogo?status=emision', SITE + '/').then(function (html) {
    var items = _cards(html);
    if (!items.length) return [];
    return [{ title: 'En emisión', items: items }];
  }).catch(function () { return []; });
}

// ── Helpers de parsing del script de SvelteKit ─────────────────────────────
// Busca el primer <script> que contenga "kit.start(app, element" y devuelve
// su contenido. Sin lazy problemático: hacemos split por <script ...> y
// buscamos el que tenga kit.start dentro.
function _kitScript(html) {
  var h = String(html || '');
  var re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi, m;
  while ((m = re.exec(h)) !== null) {
    if (m[1].indexOf('kit.start(app, element') > -1) return m[1];
  }
  return '';
}

// Extrae el objeto `media:{...}` del script del kit. Es un objeto JS, no
// JSON, así que lo tratamos con regex sobre el texto.
function _extractMediaObj(script) {
  var i = script.indexOf('media:{');
  if (i < 0) return '';
  // Buscamos el cierre del objeto contando llaves desde ese punto.
  var start = i + 'media:'.length; // posición de la "{"
  var depth = 0, inStr = false, quote = '', esc = false;
  for (var j = start; j < script.length; j++) {
    var ch = script[j];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === quote) { inStr = false; }
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return script.slice(start, j + 1);
    }
  }
  return '';
}

// Extrae el objeto `embeds:{SUB:[...],DUB:[...]}` del script del kit.
function _extractEmbedsObj(script) {
  var i = script.indexOf('embeds:{');
  if (i < 0) return '';
  var start = i + 'embeds:'.length;
  var depth = 0, inStr = false, quote = '', esc = false;
  for (var j = start; j < script.length; j++) {
    var ch = script[j];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === quote) { inStr = false; }
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return script.slice(start, j + 1);
    }
  }
  return '';
}

function _epUrl(cat, slug, num) {
  return 'animeav1://' + cat + '/' + slug + '/' + num;
}

var _detailCache = {};
var _DETAIL_TTL = 300000;

function getDetail(url, opts) {
  var key = String(url) + '|' + _mode(opts);
  var hit = _detailCache[key], now = Date.now();
  if (hit && (now - hit.at) < _DETAIL_TTL) return Promise.resolve(hit.value);
  return _fetchDetail(url, opts).then(function (d) {
    if (d && d.episodes && d.episodes.length) {
      _detailCache[key] = { at: Date.now(), value: d };
    }
    return d;
  });
}

function _fetchDetail(url, opts) {
  var slug = String(url).replace(/^\/+/, '').replace(/\/.*$/, '');
  var cat = _mode(opts);
  return _get(SITE + '/media/' + encodeURIComponent(slug), SITE + '/')
    .then(function (html) {
      var script = _kitScript(html);
      var mediaObj = script ? _extractMediaObj(script) : '';

      // Título
      var title = (mediaObj.match(/title:"((?:[^"\\]|\\.)*)"/) || [])[1]
               || _text((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1])
               || slug;
      title = title.replace(/\\"/g, '"').replace(/\\n/g, ' ');

      // Sinopsis
      var synopsis = (mediaObj.match(/synopsis:"((?:[^"\\]|\\.)*)"/) || [])[1] || '';
      synopsis = synopsis.replace(/\\"/g, '"').replace(/\\n/g, '\n');

      // Cover
      var cover = (mediaObj.match(/poster:"([^"]+)"/) || [])[1]
               || (html.match(/<figure[^>]*>[\s\S]{0,500}?<img[^>]+src="([^"]+)"/) || [])[1]
               || (html.match(/property="og:image"[^>]*content="([^"]+)"/) || [])[1]
               || null;

      // ID interno (para banner/backdrop)
      var mid = (mediaObj.match(/\bid:(\d+),categoryId/) || [])[1];
      var banner = mid ? (CDN + '/thumbnails/' + mid + '.jpg') : null;

      // Año
      var yearM = mediaObj.match(/startDate:"(\d{4})/);
      var year = yearM ? parseInt(yearM[1], 10) : null;

      // Tipo (category.name)
      var catM = mediaObj.match(/category:\{id:\d+,name:"([^"]+)"/);
      var catName = catM ? catM[1] : '';
      var isMovie = /pel[ií]cula|especial|movie/i.test(catName);

      // MAL id
      var malM = mediaObj.match(/malId:(\d+)/);
      var malId = malM ? parseInt(malM[1], 10) : null;

      // ── Episodios ──────────────────────────────────────────────────────
      // Los sacamos directamente del array `episodes:[{id:N,number:M},...]`
      // que está dentro de mediaObj. Fallback a `episodesCount:N`.
      var eps = [];
      var epArrM = mediaObj.match(/episodes:\[([\s\S]*?)\](?:,|\})/);
      if (epArrM) {
        var re = /\{id:(\d+),number:(\d+)\}/g, m;
        while ((m = re.exec(epArrM[1])) !== null) {
          var num = parseInt(m[2], 10);
          eps.push({
            id: cat + ':' + num,
            number: num,
            title: 'Episodio ' + num,
            url: _epUrl(cat, slug, num)
          });
        }
      }
      if (!eps.length) {
        var countM = (mediaObj.match(/episodesCount:(\d+)/) || [])[1];
        var count = countM ? parseInt(countM, 10) : 0;
        for (var i = 1; i <= count; i++) {
          eps.push({
            id: cat + ':' + i,
            number: i,
            title: 'Episodio ' + i,
            url: _epUrl(cat, slug, i)
          });
        }
      }

      // Si solo hay 1 episodio, es probablemente una película → no numerar.
      if (eps.length === 1) eps[0].title = title;

      return {
        id: slug, title: title, englishTitle: title, url: slug,
        cover: cover,
        banner: banner,
        description: synopsis,
        status: 'unknown',
        genres: [],
        studios: [],
        type: isMovie ? 'movie' : 'anime',
        sourceId: SOURCE_ID,
        episodes: eps,
        year: year,
        malId: malId,
        subCount: 0, dubCount: 0
      };
    });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes; });
}

// ── Streams ────────────────────────────────────────────────────────────────
function getVideoSources(episodeUrl) {
  var parts = String(episodeUrl).replace('animeav1://', '').split('/');
  var cat = (parts[0] === 'dub') ? 'dub' : 'sub';
  var slug = parts[1] || '';
  var num = parts[2] || '1';
  if (!slug) return Promise.reject(new Error('AnimeAV1: no slug'));

  var url = SITE + '/media/' + slug + '/' + num;
  return _get(url, SITE + '/').then(function (html) {
    var script = _kitScript(html);
    if (!script) throw new Error('AnimeAV1: no kit script');

    var embedsObj = _extractEmbedsObj(script);
    if (!embedsObj) throw new Error('AnimeAV1: no embeds');

    // Extrae el array SUB:[...] o DUB:[...] de dentro de embedsObj.
    var re = new RegExp(cat.toUpperCase() + ':\\[([\\s\\S]*?)\\]');
    var arrM = embedsObj.match(re);
    if (!arrM) throw new Error('AnimeAV1: no ' + cat + ' embeds');

    // Cada mirror es {server:"...",url:"..."}
    var servers = [];
    var re2 = /\{server:"([^"]+)",url:"([^"]+)"\}/g, m;
    while ((m = re2.exec(arrM[1])) !== null) {
      servers.push({ name: m[1], url: m[2] });
    }
    if (!servers.length) throw new Error('AnimeAV1: no servers');

    return _tryServers(servers, 0, cat, url);
  });
}

function _tryServers(list, i, cat, ref) {
  if (i >= list.length) {
    return Promise.reject(new Error('AnimeAV1: no playable server'));
  }
  return _extractStream(list[i].url, cat, ref).catch(function () {
    return _tryServers(list, i + 1, cat, ref);
  });
}

// El servidor "HLS" de AnimeAV1 (player.zilla-networks.com) es el más fiable:
// devuelve un m3u8 directo dentro del HTML. Los otros (UPNShare, Voe, Byse,
// MP4Upload) requieren POST/decrypt y se intentan como fallback.
function _extractStream(embed, cat, ref) {
  var base = (embed.match(/^https?:\/\/[^/]+/) || [])[0] || SITE;
  return _get(embed, ref || SITE + '/').then(function (html) {
    var file = null;

    // 1) m3u8 directo
    var m1 = html.match(/(https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*)/);
    if (m1) file = m1[1];

    // 2) file: "..." (JW/Clappr)
    if (!file) {
      var m2 = html.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i);
      if (m2) file = m2[1];
    }
    // 3) sources: [{file:"..."}]
    if (!file) {
      var m3 = html.match(/sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+)["']/i);
      if (m3) file = m3[1];
    }
    // 4) base64 dentro de atob(...)
    if (!file) {
      var m5 = html.match(/atob\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/);
      if (m5) {
        var dec = _b64(m5[1]);
        var m5b = dec.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);
        if (m5b) file = m5b[1];
      }
    }

    if (!file) throw new Error('AnimeAV1: no stream');

    return [{
      url: file,
      quality: 'auto',
      container: /\.m3u8(\?|$)/i.test(file) ? 'hls' : 'mp4',
      headers: {
        'User-Agent': UA,
        'Referer': base + '/',
        'Origin': base
      },
      kind: cat,
      audioLang: cat === 'dub' ? 'es' : 'ja',
      subtitles: []
    }];
  });
}

function _b64(s) {
  try {
    var b = base64ToBytes(String(s || '')), o = '';
    for (var i = 0; i < b.length; i++) o += String.fromCharCode(b[i]);
    return o;
  } catch (e) { return ''; }
}
