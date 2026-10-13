// providers/animeav1.js — AnimeAV1 for Zangetsu
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'animeav1';
var SITE = 'https://animeav1.com';
var API = 'https://animeav1.ahmedrangel.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeAV1', lang: 'es', baseUrl: SITE,
    logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.4' };
}

function _mode(opts) { return (opts && opts.category === 'dub') ? 'dub' : 'sub'; }

function _get(url, ref) {
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json, text/html, */*',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Referer': ref || SITE + '/'
    }
  }).then(function (r) { return r.body || ''; })
    .catch(function () { return ''; });
}

function _text(s) {
  return htmlText(String(s || '').replace(/<[^>]*>/g, '')).replace(/^\s+|\s+$/g, '');
}

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
    var titleM = c.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || c.match(/alt="([^"]+)"/i);
    if (!titleM) continue;
    seen[slug] = 1;
    out.push({ id: slug, title: _text(titleM[1]), englishTitle: _text(titleM[1]),
      cover: imgM ? imgM[1] : null, url: slug, type: 'anime',
      sourceId: SOURCE_ID, subCount: 0, dubCount: 0 });
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

function _epUrl(cat, slug, num) { return 'animeav1://' + cat + '/' + slug + '/' + num; }

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
  var apiUrl = API + '/api/anime/' + encodeURIComponent(slug);

  return _get(apiUrl, SITE + '/media/' + slug).then(function (body) {
    var j = null;
    try { j = JSON.parse(body); } catch (e) { j = null; }
    if (!j || !j.success || !j.data) {
      return { id: slug, title: slug, url: slug, episodes: [],
        cover: null, description: 'API sin datos válidos',
        type: 'anime', sourceId: SOURCE_ID, subCount: 0, dubCount: 0 };
    }
    var d = j.data;
    var title = d.title || slug;
    var typeName = String(d.type || '');
    var isMovie = /pel[ií]cula|especial|movie/i.test(typeName);

    var eps = [];
    if (d.episodes && d.episodes.length) {
      for (var i = 0; i < d.episodes.length; i++) {
        var ep = d.episodes[i];
        if (!ep || typeof ep.number !== 'number') continue;
        eps.push({ id: cat + ':' + ep.number, number: ep.number,
          title: 'Episodio ' + ep.number, url: _epUrl(cat, slug, ep.number) });
      }
    }
    if (eps.length === 1) eps[0].title = title;

    return { id: slug, title: title, englishTitle: title, url: slug,
      cover: d.cover || null, banner: null,
      description: d.synopsis || '',
      status: 'unknown',
      genres: Array.isArray(d.genres) ? d.genres : [],
      studios: [],
      type: isMovie ? 'movie' : 'anime',
      sourceId: SOURCE_ID, episodes: eps,
      year: typeof d.year === 'number' ? d.year : null,
      malId: typeof d.malId === 'number' ? d.malId : null,
      subCount: 0, dubCount: 0 };
  }).catch(function () {
    return { id: slug, title: slug, url: slug, episodes: [],
      cover: null, description: 'Error de fetch',
      type: 'anime', sourceId: SOURCE_ID, subCount: 0, dubCount: 0 };
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

  var apiUrl = API + '/api/anime/' + encodeURIComponent(slug) + '/' + encodeURIComponent(num);
  return _get(apiUrl, SITE + '/media/' + slug + '/' + num).then(function (body) {
    var j = null;
    try { j = JSON.parse(body); } catch (e) { j = null; }
    if (!j || !j.success || !j.data) throw new Error('Episodio sin datos');
    var embeds = j.data.embeds || [];
    var wanted = [];
    for (var i = 0; i < embeds.length; i++) {
      var e = embeds[i];
      if (!e || !e.url) continue;
      var t = String(e.type || '').toLowerCase();
      if (t === '' || t === cat || t === 'sub' || t === 'dub') wanted.push(e);
    }
    if (!wanted.length) wanted = embeds.filter(function (e) { return e && e.url; });
    if (!wanted.length) throw new Error('Sin servidores');
    return _tryEmbeds(wanted, 0, cat);
  });
}

function _tryEmbeds(list, i, cat) {
  if (i >= list.length) return Promise.reject(new Error('Ningún servidor reproducible'));
  return _extractStream(list[i].url, cat).catch(function () { return _tryEmbeds(list, i + 1, cat); });
}

function _extractStream(embed, cat) {
  var base = (embed.match(/^https?:\/\/[^/]+/) || [])[0] || SITE;
  return _get(embed, SITE + '/').then(function (html) {
    var file = null;
    var m1 = html.match(/(https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*)/);
    if (m1) file = m1[1];
    if (!file) { var m2 = html.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i); if (m2) file = m2[1]; }
    if (!file) { var m3 = html.match(/sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+)["']/i); if (m3) file = m3[1]; }
    if (!file) throw new Error('Sin stream');
    return [{ url: file, quality: 'auto',
      container: /\.m3u8(\?|$)/i.test(file) ? 'hls' : 'mp4',
      headers: { 'User-Agent': UA, 'Referer': base + '/', 'Origin': base },
      kind: cat, audioLang: cat === 'dub' ? 'es' : 'ja', subtitles: [] }];
  });
}
