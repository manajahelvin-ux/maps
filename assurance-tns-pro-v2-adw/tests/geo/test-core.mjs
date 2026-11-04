/* Test 2 — Cœur du module : état des deux blocs, indépendance stricte,
   validations, persistance sessionStorage, anti-injection, payload CRM. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDom, installFetchStub, loadGeo, tick } from './helpers.mjs';

function newEnv() {
  const dom = createDom();
  installFetchStub(dom.window);
  loadGeo(dom.window, { preConfig: { nominatim: { minIntervalMs: 5 } } });
  return dom;
}

test('CPGeo est initialisé avec ses deux blocs vides et indépendants', () => {
  const dom = newEnv();
  const { CPGeo } = dom.window;
  assert.equal(CPGeo.getLocation().status, 'empty');
  assert.equal(CPGeo.getBuilding().status, 'empty');
  dom.window.close();
});

test('indépendance : setLocation ne modifie jamais le bloc bâtiment (et inversement)', () => {
  const dom = newEnv();
  const { CPGeo } = dom.window;
  CPGeo.setLocation({ address: '12 Rue de la Paix 75002 Paris', latitude: 48.8566, longitude: 2.3522, status: 'found' });
  assert.equal(CPGeo.getBuilding().status, 'empty');
  assert.equal(CPGeo.getBuilding().address, '');
  assert.equal(CPGeo.getBuilding().latitude, null);

  CPGeo.setBuilding({ address: '12 Rue de la Paix', latitude: 48.8567, longitude: 2.3523, building_image_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg', status: 'pending' });
  const loc = CPGeo.getLocation();
  assert.equal(loc.latitude, 48.8566, 'la localisation ne doit pas bouger');
  assert.equal(loc.address, '12 Rue de la Paix 75002 Paris');
  dom.window.close();
});

test('validation localisation : impossible sans coordonnées, horodatée sinon', () => {
  const dom = newEnv();
  const { CPGeo } = dom.window;
  assert.equal(CPGeo.validateLocation(), null, 'rien à valider sans données');
  CPGeo.setLocation({ address: 'A', latitude: 48.85, longitude: 2.35 });
  const v = CPGeo.validateLocation();
  assert.equal(v.validated, true);
  assert.equal(v.status, 'validated');
  assert.ok(!Number.isNaN(Date.parse(v.validated_at)));
  dom.window.close();
});

test('validation bâtiment : exige une image sélectionnée', () => {
  const dom = newEnv();
  const { CPGeo } = dom.window;
  CPGeo.setBuilding({ address: 'A', latitude: 48.85, longitude: 2.35 });
  assert.equal(CPGeo.validateBuilding(), null, 'sans image : pas de validation possible');
  CPGeo.setBuilding({ building_image_url: 'https://upload.wikimedia.org/x.jpg', image_source: 'Wikimedia Commons', image_type: 'photo_exterieure' });
  const v = CPGeo.validateBuilding();
  assert.equal(v.validated, true);
  assert.equal(v.status, 'validated');
  dom.window.close();
});

test('modifier une donnée validée retire la validation automatiquement', () => {
  const dom = newEnv();
  const { CPGeo } = dom.window;
  CPGeo.setLocation({ address: 'A', latitude: 48.85, longitude: 2.35 });
  CPGeo.validateLocation();
  assert.equal(CPGeo.getLocation().validated, true);

  CPGeo.setLocation({ latitude: 48.9, longitude: 2.4 });   /* marqueur déplacé */
  assert.equal(CPGeo.getLocation().validated, false, 'position modifiée => plus validée');
  assert.equal(CPGeo.getLocation().validated_at, '');

  CPGeo.validateLocation();
  CPGeo.setLocation({ status: 'searching' }, { silent: true }); /* changement d’état seul */
  assert.equal(CPGeo.getLocation().validated, true, 'un statut seul ne dévalide pas');
  dom.window.close();
});

test('persistance sessionStorage : restauration après rechargement simulé', async () => {
  const dom = newEnv();
  const { CPGeo, sessionStorage } = dom.window;
  CPGeo.setLocation({ address: '12 Rue de la Paix 75002 Paris', latitude: 48.8566, longitude: 2.3522, postal_code: '75002', city: 'Paris', country: 'France', country_code: 'FR' });
  CPGeo.validateLocation();
  CPGeo.setBuilding({ address: '12 Rue de la Paix', latitude: 48.8566, longitude: 2.3522, building_image_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg', image_source: 'Wikimedia Commons', image_type: 'photo_exterieure' });
  CPGeo.validateBuilding();
  const saved = sessionStorage.getItem('cp_geo_module_v1');
  assert.ok(saved && saved.length > 100);

  /* Nouveau contexte, même stockage : simule un rechargement de page.
     Le montage UI est asynchrone (DOMContentLoaded) : on attend un tick. */
  const dom2 = createDom();
  installFetchStub(dom2.window);
  dom2.window.sessionStorage.setItem('cp_geo_module_v1', saved);
  loadGeo(dom2.window, { preConfig: { nominatim: { minIntervalMs: 5 } } });
  await tick(40);
  const restored = dom2.window.cpGeo.getData();
  assert.equal(restored.company_location.validated, true);
  assert.equal(restored.company_location.address, '12 Rue de la Paix 75002 Paris');
  assert.equal(restored.company_building.validated, true);
  assert.equal(restored.company_building.building_image_url, 'https://upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg');

  dom.window.close();
  dom2.window.close();
});

test('champ caché geo_json synchronisé avec le formulaire (secours DOM)', () => {
  const dom = newEnv();
  const { document, CPGeo } = dom.window;
  CPGeo.setLocation({ address: 'X', latitude: 1, longitude: 2 });
  const hidden = document.querySelector('form[data-ubepro-lead="1"] input[name="geo_json"]');
  assert.ok(hidden, 'le champ caché doit exister dans le formulaire');
  const parsed = JSON.parse(hidden.value);
  assert.equal(parsed.company_location.address, 'X');
  dom.window.close();
});

test('payload CRM : objet structuré + champs plats, valeurs vides supprimées', () => {
  const dom = newEnv();
  const { CPGeo } = dom.window;
  CPGeo.setLocation({
    status: 'found', search_id: 'test-search-0001',
    company_name: 'Boulangerie Dupont', address: '12 Rue de la Paix 75002 Paris',
    postal_code: '75002', city: 'Paris', country: 'France', country_code: 'FR',
    latitude: 48.8566, longitude: 2.3522,
    map_url: 'https://www.openstreetmap.org/?mlat=48.8566&mlon=2.3522#map=17',
    map_image_url: 'https://tile.openstreetmap.org/17/66392/45092.png',
    map_provider: 'OpenStreetMap', geocode_source: 'BAN (Base Adresse Nationale)'
  });
  CPGeo.validateLocation();
  CPGeo.setBuilding({
    address: '12 Rue de la Paix 75002 Paris', postal_code: '75002', city: 'Paris',
    country: 'France', latitude: 48.8566, longitude: 2.3522,
    building_image_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg',
    image_source: 'Wikimedia Commons', image_type: 'photo_exterieure',
    image_license: 'CC BY-SA 4.0', image_author: 'Jean Dupont', image_distance_m: 12,
    aerial_image_url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/18/90184/132784',
    aerial_provider: 'Esri World Imagery'
  });
  CPGeo.validateBuilding();

  const payload = CPGeo.getLeadPayload();
  /* 1) objet JSON structuré conforme à la spécification */
  const s = payload.structured;
  assert.equal(s.company_location.company_name, 'Boulangerie Dupont');
  assert.equal(s.company_location.latitude, 48.8566);
  assert.equal(s.company_location.map_provider, 'OpenStreetMap');
  assert.equal(s.company_location.validated, true);
  assert.equal(s.company_building.image_type, 'photo_exterieure');
  assert.equal(s.company_building.image_source, 'Wikimedia Commons');
  assert.equal(s.company_building.validated, true);
  assert.ok(s.lead_id && s.search_id);

  /* 2) champs plats pour CRM/Sheets */
  const f = payload.flat;
  assert.equal(f.geo_adresse, '12 Rue de la Paix 75002 Paris');
  assert.equal(f.geo_latitude, '48.8566');
  assert.equal(f.geo_localisation_validee, 'oui');
  assert.equal(f.geo_batiment_image_type, 'photo_exterieure');
  assert.equal(f.geo_batiment_valide, 'oui');
  assert.ok(f.geo_entreprise && JSON.parse(f.geo_entreprise).company_location.city === 'Paris');

  /* aucun champ plat vide */
  Object.entries(f).forEach(([k, v]) => assert.ok(v !== '' && v != null, `champ plat vide : ${k}`));
  dom.window.close();
});

test('anti-injection : seules les clés connues entrent dans l’état', () => {
  const dom = newEnv();
  const { CPGeo } = dom.window;
  const hostile = JSON.parse('{"__proto__": {"polluted": true}, "address": "OK", "evil_key": "x", "latitude": "<script>"}');
  CPGeo.setLocation(hostile);
  const loc = CPGeo.getLocation();
  assert.equal(loc.address, 'OK');
  assert.equal(loc.evil_key, undefined, 'clé inconnue ignorée');
  assert.equal(({}).polluted, undefined, 'pas de pollution de prototype');
  assert.equal(loc.latitude, null, 'latitude non numérique normalisée en null');
  dom.window.close();
});

test('historique borné et horodaté', () => {
  const dom = newEnv();
  const { CPGeo } = dom.window;
  for (let i = 0; i < 60; i++) CPGeo.addHistory({ action: 'test', i });
  const data = CPGeo.getData();
  assert.ok(data.history.length <= 40, 'historique plafonné');
  assert.ok(data.history.every((h) => h.at));
  dom.window.close();
});

test('façade publique window.cpGeo figée et complète', () => {
  const dom = newEnv();
  const { cpGeo } = dom.window;
  assert.ok(Object.isFrozen(cpGeo));
  ['getLeadPayload', 'getData', 'getLocation', 'getBuilding', 'getStatus',
    'validateLocation', 'validateBuilding', 'reset'].forEach((m) => {
    assert.equal(typeof cpGeo[m], 'function', `cpGeo.${m} manquant`);
  });
  dom.window.close();
});

test('dataLayer : aucun événement poussé par défaut (conversions préservées)', async () => {
  const dom = newEnv();
  const { CPGeo, dataLayer } = dom.window;
  const before = (dom.window.dataLayer || []).length;
  CPGeo.setLocation({ address: 'A', latitude: 1, longitude: 2 });
  CPGeo.validateLocation();
  CPGeo.track('geo_location_validated', {});
  await tick(10);
  assert.equal((dom.window.dataLayer || []).length, before, 'pushDataLayerEvents=false par défaut');
  assert.ok(dataLayer === undefined || Array.isArray(dataLayer));
  dom.window.close();
});
