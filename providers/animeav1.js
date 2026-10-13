// providers/animeav1.js — AnimeAV1 source for Zangetsu (animeav1.com)
//
// Estructura del sitio:
//   /catalogo?search=&category=&genre=&page=  -> grilla de cards
//   /media/<slug>                             -> detalle + lista de episodios
//   /media/<slug>/<num>                       -> página del episodio
//
// Los servidores viven dentro de un <script> con la config del player
// ("kit.start(app, element, {...})"). Ahí dentro hay
// `embeds: { SUB: [...], DUB: [...] }` con los mirrors.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'animeav1';

var SITE = 'https://animeav1.com';
var CDN = 'https://cdn.animeav1.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeAV1', lang: 'es', baseUrl: SITE,
    logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.0' };
}

function _mode(opts) { return (opts && opts.category === 'dub') ? 'dub' : 'sub'; }

function _get(url, ref) {
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': ref || SITE + '/' }
  }).then(function (r) { return r.body || ''; })
    .catch(function () { return ''; });
}

function _text(s) {
  return htmlText(String(s || '').replace(/<[^>]*>/g, ''))
    .replace(/^\s+|\s+$/g, '');
}

function _esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

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

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (q.length < 1) return Promise.resolve([]);
  var p = (page && page > 1) ? page : 1;
  var url = SITE + '/catalogo?search=' + encodeURIComponent(q)
    + '&category=tv-anime&category=ova&category=especial';
  if (p > 1) url += '&page=' + p;
  return _get(url, SITE + '/').then(_cards).catch(function () { return []; });
}

function getHome(opts) {
  return _get(SITE + '/catalogo?status=emision', SITE + '/').then(function (html) {
    var items = _cards(html);
    if (!items.length) return [];
    return [{ title: 'En emisión', items: items }];
  }).catch(function () { return []; });
}

function _kitScript(html) {
  var re = /<script[^>]*>([\s\S]*?)<\/script>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var body = m[1];
    if (body.indexOf('kit.start(app, element') > -1) return body;
  }
  return '';
}

function _parseEmbeds(src) {
  if (!src) return [];
  var parts = String(src).split(/},/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var srv = (parts[i].match(/server:\s*"([^"]+)"/) || [])[1];
    var url = (parts[i].match(/url:\s*"([^"]+)"/) || [])[1];
    if (url) out.push({ name: srv || 'Server', url: url });
  }
  return out;
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
  var slug = String(url).replace(/^\/+/, '');
  var cat = _mode(opts);
  return _get(SITE + '/media/' + encodeURIComponent(slug), SITE + '/')
    .then(function (html) {
      var script = _kitScript(html);

      var title = _text((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1])
               || (script.match(/title:\s*"([^"]+)"/) || [])[1]
               || slug;

      var synopsis = _text((html.match(/class="entry[^"]*"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/) || [])[1])
                  || _text((script.match(/synopsis:\s*"([\s\S]*?)"/) || [])[1]);

      var cover = (html.match(/<figure[^>]*>[\s\S]{0,300}?<img[^>]+src="([^"]+)"/) || [])[1]
               || (html.match(/property="og:image"[^>]*content="([^"]+)"/) || [])[1] || null;

      var yearM = script.match(/startDate:\s*"(\d{4})/);
      var year = yearM ? parseInt(yearM[1], 10) : null;

      var typeM = script.match(/category:\s*\{[^}]*name:\s*"([^"]+)"/);
      var typeName = typeM ? typeM[1] : '';

      var idM = cover ? cover.match(/\/(\d+)\.jpg$/) : null;
      var internalId = idM ? idM[1] : null;

      var eps = [];
      var countM = script.match(/episodesCount:\s*(\d+)/);
      var count = countM ? parseInt(countM[1], 10) : 0;
      if (count > 0) {
        for (var i = 1; i <= count; i++) {
          eps.push({
            id: cat + ':' + i,
            number: i,
            title: 'Episodio ' + i,
            url: _epUrl(cat, slug, i)
          });
        }
      } else {
        var re = new RegExp('/media/' + _esc(slug) + '/(\\d+)', 'g'), m, seen = {};
        while ((m = re.exec(html)) !== null) {
          var n = parseInt(m[1], 10);
          if (seen[n]) continue;
          seen[n] = 1;
          eps.push({ id: cat + ':' + n, number: n,
            title: 'Episodio ' + n, url: _epUrl(cat, slug, n) });
        }
        eps.sort(function (a, b) { return a.number - b.number; });
      }

      if (eps.length === 1) {
        eps[0].title = title;
      }

      return {
        id: slug, title: title, englishTitle: title, url: slug,
        cover: cover,
        banner: internalId ? (CDN + '/thumbnails/' + internalId + '.jpg') : null,
        description: synopsis,
        status: 'unknown',
        genres: [],
        studios: [],
        type: (typeName === 'Pelicula' || typeName === 'Película'
            || typeName === 'Especial' || typeName === 'movie') ? 'movie' : 'anime',
        sourceId: SOURCE_ID,
        episodes: eps,
        year: year,
        malId: null,
        subCount: 0, dubCount: 0
      };
    });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes; });
}

function getVideoSources(episodeUrl) {
  var parts = String(episodeUrl).replace('animeav1://', '').split('/');
  var cat = (parts[0] === 'dub') ? 'dub' : 'sub';
  var slug = parts[1] || '';
  var num = parts[2] || '1';
  if (!slug) return Promise.reject(new Error('AnimeAV1: no slug'));

  var url = SITE + '/media/' + slug + '/' + num;
  return _get(url, SITE + '/').then(function (html) {
    var script = _kitScript(html);
    if (!script) throw new Error('AnimeAV1: no player script');

    var subEmbeds = (script.match(/embeds:[\s\S]*?SUB:\s*(\[[\s\S]*?\])/) || [])[1];
    var dubEmbeds = (script.match(/embeds:[\s\S]*?DUB:\s*(\[[\s\S]*?\])/) || [])[1];

    var want = (cat === 'dub') ? dubEmbeds : subEmbeds;
    var servers = _parseEmbeds(want);

    if (!servers.length) {
      throw new Error('AnimeAV1: no ' + cat + ' servers');
    }
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

function _extractStream(embed, cat, ref) {
  var base = (embed.match(/^https?:\/\/[^/]+/) || [])[0] || SITE;
  return _get(embed, ref || SITE + '/').then(function (html) {
    var file = null;

    var m1 = html.match(/(https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*)/);
    if (m1) file = m1[1];

    if (!file) {
      var m2 = html.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i);
      if (m2) file = m2[1];
    }
    if (!file) {
      var m3 = html.match(/sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+)["']/i);
      if (m3) file = m3[1];
    }
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
