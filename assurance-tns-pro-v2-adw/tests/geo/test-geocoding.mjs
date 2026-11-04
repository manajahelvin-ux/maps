/* Test 3 — Géocodage France (BAN) et Europe (Nominatim) :
   routage par pays, normalisation WGS84, compléments, replis,
   déduplication, tri, throttle Nominatim, géocodage inverse, erreurs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDom, installFetchStub, loadGeo, tick,
  BAN_FIXTURE, NOMINATIM_FIXTURE, BAN_REVERSE_FIXTURE
} from './helpers.mjs';

function env(handlers, preConfig) {
  const dom = createDom();
  installFetchStub(dom.window, handlers);
  loadGeo(dom.window, { preConfig: Object.assign({ nominatim: { minIntervalMs: 5 } }, preConfig) });
  return dom;
}
function callsOf(dom, needle) {
  return dom.window.fetchCalls.filter((c) => c.url.includes(needle));
}

test('France avec adresse : la BAN est interrogée en priorité', async () => {
  const dom = env();
  const results = await dom.window.CPGeo.geocoding.search({
    companyName: 'Boulangerie Dupont',
    houseNumber: '12', street: 'Rue de la Paix',
    postalCode: '75002', city: 'Paris', countryCode: 'FR'
  });
  const ban = callsOf(dom, 'api-adresse.data.gouv.fr/search');
  assert.equal(ban.length, 1, 'un seul appel BAN');
  const url = new URL(ban[0].url);
  assert.match(url.searchParams.get('q'), /12 Rue de la Paix 75002 Paris/i);
  assert.equal(url.searchParams.get('postcode'), '75002');
  /* >= 3 résultats BAN : pas d'appel Nominatim complémentaire */
  assert.equal(callsOf(dom, 'nominatim.openstreetmap.org').length, 0);

  assert.ok(results.length >= 3);
  const first = results[0];
  assert.equal(first.source, 'BAN (Base Adresse Nationale)');
  assert.equal(first.country_code, 'FR');
  assert.equal(first.postal_code, '75002');
  assert.equal(first.latitude, 48.8566);
  assert.equal(first.longitude, 2.3522);
  assert.equal(first.result_type, 'housenumber');
  /* tri : numéro de rue d'abord, puis rue, puis commune */
  assert.equal(results[results.length - 1].result_type, 'municipality');
  /* déduplication : le doublon exact de la fixture a disparu */
  const labels = results.map((r) => r.label);
  assert.equal(labels.filter((l) => l === '12 Rue de la Paix 75002 Paris').length, 1);
  dom.window.close();
});

test('France : BAN < 3 résultats => complément Nominatim', async () => {
  const dom = env({
    'api-adresse.data.gouv.fr/search': () => ({
      ok: true, status: 200,
      json: () => Promise.resolve({ type: 'FeatureCollection', features: BAN_FIXTURE.features.slice(0, 1) })
    })
  });
  const results = await dom.window.CPGeo.geocoding.search({
    street: 'Rue de la Paix', postalCode: '75002', city: 'Paris', countryCode: 'FR'
  });
  const nomi = callsOf(dom, 'nominatim.openstreetmap.org/search');
  assert.equal(nomi.length, 1);
  const nomiUrl = new URL(nomi[0].url);
  assert.equal(nomiUrl.searchParams.get('countrycodes'), 'fr');
  assert.match(nomiUrl.searchParams.get('q'), /Rue de la Paix/);
  assert.ok(results.length >= 2, 'BAN + OSM fusionnés');
  dom.window.close();
});

test('France : échec BAN => repli Nominatim transparent', async () => {
  const dom = env({
    'api-adresse.data.gouv.fr/search': () => ({ ok: false, status: 503, json: () => Promise.resolve({}) })
  });
  const results = await dom.window.CPGeo.geocoding.search({
    street: 'Rue de la Paix', postalCode: '75002', city: 'Paris', countryCode: 'FR'
  });
  assert.equal(callsOf(dom, 'nominatim.openstreetmap.org/search').length, 1);
  assert.ok(results.length >= 1);
  assert.equal(results[0].source, 'Nominatim (OpenStreetMap)');
  dom.window.close();
});

test('Belgique : Nominatim seul avec countrycodes=be (pas de BAN)', async () => {
  const dom = env();
  const results = await dom.window.CPGeo.geocoding.search({
    street: 'Rue Royale', postalCode: '1000', city: 'Bruxelles', countryCode: 'BE'
  });
  assert.equal(callsOf(dom, 'api-adresse.data.gouv.fr').length, 0);
  const nomi = callsOf(dom, 'nominatim.openstreetmap.org/search')[0];
  const url = new URL(nomi.url);
  assert.equal(url.searchParams.get('countrycodes'), 'be');
  assert.equal(url.searchParams.get('addressdetails'), '1');
  const bruxelles = results.find((r) => /Boulangerie/i.test(r.label));
  assert.equal(bruxelles.country_code, 'BE');
  assert.equal(bruxelles.country, 'Belgique');
  assert.equal(bruxelles.postal_code, '1000');
  assert.equal(typeof bruxelles.latitude, 'number');
  dom.window.close();
});

test('recherche par nom d’entreprise seul (France) : Nominatim POI d’abord', async () => {
  const dom = env();
  const results = await dom.window.CPGeo.geocoding.search({
    companyName: 'Boulangerie Dupont', city: 'Paris', countryCode: 'FR'
  });
  const nomi = callsOf(dom, 'nominatim.openstreetmap.org/search')[0];
  assert.ok(nomi, 'le nom sans rue passe par Nominatim (POI OSM)');
  const nomiUrl = new URL(nomi.url);
  assert.match(nomiUrl.searchParams.get('q'), /Boulangerie Dupont, Paris/);
  assert.equal(nomiUrl.searchParams.get('countrycodes'), 'fr');
  assert.ok(results.length >= 1);
  /* la BAN n'est pas appelée si les POI OSM suffisent */
  assert.equal(callsOf(dom, 'api-adresse.data.gouv.fr/search').length, 0);
  dom.window.close();
});

test('recherche vide : rejet explicite sans appel réseau', async () => {
  const dom = env();
  await assert.rejects(
    dom.window.CPGeo.geocoding.search({ countryCode: 'FR' }),
    (err) => err.code === 'empty_query' && /Renseignez/.test(err.message)
  );
  assert.equal(dom.window.fetchCalls.length, 0);
  dom.window.close();
});

test('erreur réseau : message utilisateur exploitable', async () => {
  const dom = env({
    'api-adresse.data.gouv.fr/search': () => { throw Object.assign(new Error('network down'), { name: 'AbortError' }); },
    'nominatim.openstreetmap.org/search': () => { throw Object.assign(new Error('network down'), { name: 'AbortError' }); }
  });
  await assert.rejects(
    dom.window.CPGeo.geocoding.search({ street: 'Rue de la Paix', city: 'Paris', countryCode: 'FR' }),
    (err) => err.code === 'timeout' && /trop de temps/.test(err.message)
  );
  dom.window.close();
});

test('throttle Nominatim : intervalle minimal entre deux requêtes', async () => {
  const dom = env({}, { nominatim: { minIntervalMs: 120 } });
  const t0 = Date.now();
  await dom.window.CPGeo.geocoding.search({ street: 'Rue A', city: 'Bruxelles', countryCode: 'BE' });
  await dom.window.CPGeo.geocoding.search({ street: 'Rue B', city: 'Bruxelles', countryCode: 'BE' });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 110, `intervalle respecté (mesuré ${elapsed} ms)`);
  dom.window.close();
});

test('géocodage inverse France : BAN reverse avec préservation du point exact', async () => {
  const dom = env();
  const result = await dom.window.CPGeo.geocoding.reverse(48.8570, 2.3510, 'FR');
  const rev = callsOf(dom, 'api-adresse.data.gouv.fr/reverse')[0];
  assert.ok(rev);
  assert.match(rev.url, /lat=48\.857/);
  assert.equal(result.postal_code, BAN_REVERSE_FIXTURE.features[0].properties.postcode);
  /* la position du marqueur ne doit pas être arrondie à l'adresse */
  assert.equal(result.latitude, 48.857);
  assert.equal(result.longitude, 2.351);
  dom.window.close();
});

test('géocodage inverse Europe : Nominatim reverse', async () => {
  const dom = env({
    'nominatim.openstreetmap.org/reverse': () => ({
      ok: true, status: 200,
      json: () => Promise.resolve({
        place_id: 21, lat: '50.84660', lon: '4.35280',
        display_name: 'Rue Royale, Bruxelles, 1000, Belgique',
        addresstype: 'road',
        address: { road: 'Rue Royale', postcode: '1000', city: 'Bruxelles', country: 'Belgique', country_code: 'be' }
      })
    })
  });
  const result = await dom.window.CPGeo.geocoding.reverse(50.8466, 4.3528, 'BE');
  assert.ok(callsOf(dom, 'nominatim.openstreetmap.org/reverse').length >= 1);
  assert.equal(callsOf(dom, 'api-adresse.data.gouv.fr/reverse').length, 0, 'la BAN reverse est réservée à la France');
  assert.equal(result.country_code, 'BE');
  assert.equal(result.latitude, 50.8466);
  dom.window.close();
});

test('normalisation BAN/Nominatim : unités DOMPurify-free, texte nettoyé, WGS84', () => {
  const dom = env();
  const { _normalizeBanFeature, _normalizeNominatimItem } = dom.window.CPGeo.geocoding;
  const ban = _normalizeBanFeature(BAN_FIXTURE.features[0]);
  assert.equal(ban.label, '12 Rue de la Paix 75002 Paris');
  assert.equal(ban.house_number, '12');
  assert.equal(ban.city, 'Paris');

  const nomi = _normalizeNominatimItem(NOMINATIM_FIXTURE[0]);
  assert.equal(nomi.city, 'Bruxelles');
  assert.equal(nomi.latitude, 50.8466);
  assert.equal(nomi.longitude, 4.3528);
  /* coordonnées invalides => rejet */
  assert.equal(_normalizeNominatimItem({ lat: 'abc', lon: '2' }), null);
  dom.window.close();
});
