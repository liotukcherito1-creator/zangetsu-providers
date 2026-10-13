// providers/animeav1.js — TEST MÍNIMO v9.9.9
function getInfo() {
  return { name: 'AnimeAV1', lang: 'es', baseUrl: 'https://animeav1.com',
    logo: '', type: 'anime', version: '9.9.9' };
}

function search() { return Promise.resolve([]); }
function getHome() { return Promise.resolve([]); }
function getEpisodes() { return Promise.resolve([]); }
function getVideoSources() { return Promise.reject(new Error('test')); }

function getDetail(url) {
  var slug = String(url || 'one-piece').replace(/^\/+/, '');
  var tests = [
    'https://api.github.com/zen',
    'https://animeav1.ahmedrangel.com/api/anime/' + slug,
    'https://animeav1.com/media/' + slug
  ];
  var results = [];

  // Cadena secuencial de fetch, una por URL.
  function run(i) {
    if (i >= tests.length) {
      return Promise.resolve({
        id: slug, title: 'TEST RESULTADO', url: slug,
        cover: null,
        description: results.join('\n\n'),
        type: 'anime', sourceId: 'animeav1',
        episodes: [{ id: '1', number: 1, title: 'test',
          url: 'animeav1://sub/' + slug + '/1' }],
        subCount: 0, dubCount: 0
      });
    }
    var u = tests[i];
    return fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' } })
      .then(function (r) {
        var body = (r && r.body) ? String(r.body) : '';
        results.push(
          '[' + i + '] ' + u +
          '\n   status=' + (r && r.status) +
          ' len=' + body.length +
          '\n   head=' + body.slice(0, 150).replace(/\s+/g, ' ')
        );
        return run(i + 1);
      })
      .catch(function (e) {
        results.push(
          '[' + i + '] ' + u +
          '\n   ERROR: ' + (e && e.message ? e.message : String(e))
        );
        return run(i + 1);
      });
  }

  return run(0);
}
