/* Test 4 — Images de bâtiments : fournisseurs Wikimedia Commons /
   Esri (vue aérienne), filtrage (taille, type, titre non pertinent,
   hôte non autorisé), tri par distance, isolation des erreurs,
   calcul des tuiles Web Mercator, contrôle des URL. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDom, installFetchStub, loadGeo, tick,
  COMMONS_FIXTURE, COMMONS_EMPTY_FIXTURE
} from './helpers.mjs';

function env(handlers, preConfig) {
  const dom = createDom();
  installFetchStub(dom.window, handlers);
  loadGeo(dom.window, { preConfig: Object.assign({ nominatim: { minIntervalMs: 5 } }, preConfig) });
  return dom;
}

test('tuiles Web Mercator : valeurs de référence (Paris, z17/z18)', () => {
  const dom = env();
  const { images } = dom.window.CPGeo;
  /* Vérifié indépendamment par deux formules (tan+sec et asinh) */
  assert.equal(images.lonToTileX(2.3522, 17), 66392);
  assert.equal(images.latToTileY(48.8566, 17), 45092);
  assert.equal(images.lonToTileX(2.3522, 18), 132784);
  assert.equal(images.latToTileY(48.8566, 18), 90184);

  const osm = images.staticMapTileUrl(48.8566, 2.3522, 17);
  assert.equal(osm, 'https://tile.openstreetmap.org/17/66392/45092.png');

  const aerial = images.aerialImageUrl(48.8566, 2.3522, 18);
  assert.equal(aerial, 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/18/90184/132784');

  const permalink = images.osmPermalink(48.8566, 2.3522, 17);
  assert.match(permalink, /^https:\/\/www\.openstreetmap\.org\/\?mlat=48\.856600&mlon=2\.352200#map=17\//);
  dom.window.close();
});

test('Wikimedia Commons : filtrage, tri par distance, métadonnées complètes', async () => {
  const dom = env();
  const found = await dom.window.CPGeo.images.findBuildingImages({ lat: 48.8566, lon: 2.3522, radiusM: 250 });
  const commons = dom.window.fetchCalls.filter((c) => c.url.includes('commons.wikimedia.org'))[0];
  assert.ok(commons);
  const url = new URL(commons.url);
  assert.equal(url.searchParams.get('origin'), '*', 'CORS anonyme');
  assert.equal(url.searchParams.get('ggscoord'), '48.8566|2.3522');

  /* La photo proche (12 m) est retenue en premier */
  assert.ok(found.photos.length >= 1);
  const first = found.photos[0];
  assert.equal(first.distance_m, 12);
  assert.equal(first.source, 'Wikimedia Commons');
  assert.equal(first.type, 'photo_exterieure');
  assert.equal(first.license, 'CC BY-SA 4.0');
  assert.equal(first.author, 'Jean Dupont', 'HTML de Artist nettoyé');
  assert.match(first.page_url, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  assert.ok(first.fetched_at);

  /* Filtrés : titre « Carte… » (non pertinent), image minuscule, hôte non autorisé */
  const titles = found.photos.map((p) => p.title);
  assert.ok(!titles.some((t) => /Carte/i.test(t)), 'les cartes/ plans sont exclus');
  assert.ok(!titles.some((t) => /Minuscule/i.test(t)), 'les images < 320px sont exclues');
  assert.ok(!found.photos.some((p) => /evil\.example\.com/.test(p.url)), 'hôtes hors liste blanche exclus');

  /* La vue aérienne Esri est toujours proposée en complément */
  assert.ok(found.aerial);
  assert.equal(found.aerial.type, 'satellite');
  assert.equal(found.aerial.source, 'Esri World Imagery');
  assert.match(found.aerial.url, /World_Imagery\/MapServer\/tile\/18\//);
  assert.ok(found.providers_used.includes('wikimedia-commons'));
  dom.window.close();
});

test('tri : les photos sont classées par distance croissante', async () => {
  const dom = env();
  const found = await dom.window.CPGeo.images.findBuildingImages({ lat: 48.8566, lon: 2.3522 });
  const dists = Array.from(found.photos.map((p) => p.distance_m));
  assert.deepEqual(dists, Array.from(dists).sort((a, b) => a - b));
  assert.ok(dists.includes(300), 'la photo lointaine reste listée (avec avertissement UI)');
  dom.window.close();
});

test('aucune photo : résultat vide mais vue aérienne disponible (repli)', async () => {
  const dom = env({ 'commons.wikimedia.org': () => ({ ok: true, status: 200, json: () => Promise.resolve(COMMONS_EMPTY_FIXTURE) }) });
  const found = await dom.window.CPGeo.images.findBuildingImages({ lat: 48.8566, lon: 2.3522 });
  assert.equal(found.photos.length, 0);
  assert.ok(found.aerial, 'la vue satellite reste fournie en repli');
  assert.equal(found.errors.length, 0);
  dom.window.close();
});

test('erreur fournisseur : isolée, les autres fournisseurs répondent', async () => {
  const dom = env({ 'commons.wikimedia.org': () => ({ ok: false, status: 500, json: () => Promise.resolve({}) }) });
  const found = await dom.window.CPGeo.images.findBuildingImages({ lat: 48.8566, lon: 2.3522 });
  assert.equal(found.photos.length, 0);
  assert.ok(found.aerial, 'Esri fonctionne même si Commons tombe');
  assert.equal(found.errors.length, 1);
  assert.equal(found.errors[0].provider, 'wikimedia-commons');
  dom.window.close();
});

test('contrôle des URL : liste blanche stricte (RGPD/sécurité)', () => {
  const dom = env();
  const { isAllowedUrl } = dom.window.CPGeo.utils;
  assert.ok(isAllowedUrl('https://upload.wikimedia.org/wikipedia/commons/a/b.jpg'));
  assert.ok(isAllowedUrl('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/18/1/2'));
  assert.ok(isAllowedUrl('https://tile.openstreetmap.org/17/1/2.png'));
  assert.equal(isAllowedUrl('https://evil.example.com/x.jpg'), false);
  assert.equal(isAllowedUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedUrl(''), false);
  assert.equal(isAllowedUrl('https://upload.wikimedia.org.evil.com/x.jpg'), false, 'suffixe trompeur rejeté');
  dom.window.close();
});

test('proxy Street View désactivé par défaut (pas de clé exposée)', async () => {
  const dom = env();
  const found = await dom.window.CPGeo.images.findBuildingImages({ lat: 48.8566, lon: 2.3522 });
  assert.ok(!found.providers_used.includes('street-view-proxy') ||
    !dom.window.fetchCalls.some((c) => /streetview/i.test(c.url)));
  /* activation par configuration d'un proxy (aucune clé côté client) */
  dom.window.CPGeo.config.images.streetViewProxy = 'https://proxy.example.test/streetview';
  const found2 = await dom.window.CPGeo.images.findBuildingImages({ lat: 48.8566, lon: 2.3522 });
  assert.ok(found2.providers_used.includes('street-view-proxy'));
  dom.window.close();
});

test('images : pas de scraping — uniquement des API officielles avec attribution', async () => {
  const dom = env();
  const found = await dom.window.CPGeo.images.findBuildingImages({ lat: 48.8566, lon: 2.3522 });
  found.photos.forEach((p) => {
    assert.ok(p.source, 'source obligatoire');
    assert.ok(p.license, 'licence obligatoire');
    assert.ok(p.page_url, 'page d’origine obligatoire pour attribution');
  });
  assert.match(found.aerial.license, /attribution/i);
  dom.window.close();
});
