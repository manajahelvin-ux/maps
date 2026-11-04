/* Test 5 — Intégration lead-handler.js ↔ module cp-geo :
   fusion des données géo au payload CRM (HelloLead) et à Google Sheets,
   préservation absolue du tracking (ltm_source / ltm_category / ltm_typ),
   même identifiant de lead, dégradation gracieuse sans le module. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDom, installFetchStub, loadGeo, loadScripts, tick } from './helpers.mjs';

const CONSENT_COOKIE = 'user_cookie_preferences={"necessary":true,"analytics":true,"marketing":true}';

function envWithLead({ consent = true, geo = true } = {}) {
  const dom = createDom({ cookies: consent ? CONSENT_COOKIE : undefined });
  installFetchStub(dom.window);
  loadScripts(dom.window, ['lead-handler.js']);
  if (geo) loadGeo(dom.window, { preConfig: { nominatim: { minIntervalMs: 5 } } });
  return dom;
}

function fillGeoState(window) {
  const { CPGeo } = window;
  CPGeo.setLocation({
    status: 'found',
    company_name: 'Boulangerie Dupont',
    address: '12 Rue de la Paix 75002 Paris',
    postal_code: '75002', city: 'Paris', country: 'France', country_code: 'FR',
    latitude: 48.8566, longitude: 2.3522,
    map_url: 'https://www.openstreetmap.org/?mlat=48.856600&mlon=2.352200#map=17/48.85660/2.35220',
    map_image_url: 'https://tile.openstreetmap.org/17/66392/45092.png',
    map_provider: 'OpenStreetMap',
    geocode_source: 'BAN (Base Adresse Nationale)',
    searched_at: new Date().toISOString()
  });
  CPGeo.validateLocation();
  CPGeo.setBuilding({
    status: 'pending',
    address: '12 Rue de la Paix 75002 Paris',
    postal_code: '75002', city: 'Paris', country: 'France', country_code: 'FR',
    latitude: 48.8566, longitude: 2.3522,
    building_image_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Immeuble_12_rue_de_la_Paix_Paris.jpg',
    image_source: 'Wikimedia Commons', image_type: 'photo_exterieure',
    image_license: 'CC BY-SA 4.0', image_author: 'Jean Dupont',
    image_distance_m: 12,
    aerial_image_url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/18/90184/132784',
    aerial_provider: 'Esri World Imagery',
    searched_at: new Date().toISOString()
  });
  CPGeo.validateBuilding();
}

test('payload CRM HelloLead : données géo fusionnées + tracking intact', () => {
  const dom = envWithLead();
  fillGeoState(dom.window);

  const preview = dom.window.lpLead.preview();
  const data = preview.payload.data;

  /* --- Enveloppe CRM inchangée --- */
  assert.equal(preview.payload.formId, 'ADW_LP_ASSURANCE_TNS_PRO');
  assert.ok(preview.payload.id);

  /* --- Champs existants préservés (tracking URL ltm_*) --- */
  assert.equal(data.ltm_source, 'ADW_test');
  assert.equal(data.ltm_category, 'cat_test');
  assert.equal(data.ltm_typ, 'merci-test');
  assert.equal(data.source, 'ADW_test', 'ltm_source prioritaire sur la source de secours');
  assert.equal(typeof data.autre_info_fj, 'string');
  assert.equal(data.consentement, 'non', 'aucun consentement forcé par le module');

  /* --- Objet JSON structuré (option 1 CRM) --- */
  const geo = data.geo_entreprise_module;
  assert.ok(geo, 'objet structuré présent');
  assert.equal(geo.company_location.address, '12 Rue de la Paix 75002 Paris');
  assert.equal(geo.company_location.latitude, 48.8566);
  assert.equal(geo.company_location.map_provider, 'OpenStreetMap');
  assert.equal(geo.company_location.validated, true);
  assert.equal(geo.company_building.image_source, 'Wikimedia Commons');
  assert.equal(geo.company_building.image_type, 'photo_exterieure');
  assert.equal(geo.company_building.validated, true);
  assert.equal(geo.lead_id, preview.payload.id, 'mêmes identifiants de lead');

  /* --- Champs plats individuels (option 2 CRM) --- */
  assert.equal(data.geo_adresse, '12 Rue de la Paix 75002 Paris');
  assert.equal(data.geo_code_postal, '75002');
  assert.equal(data.geo_ville, 'Paris');
  assert.equal(data.geo_latitude, '48.8566');
  assert.equal(data.geo_longitude, '2.3522');
  assert.equal(data.geo_localisation_validee, 'oui');
  assert.equal(data.geo_batiment_image_url, 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Immeuble_12_rue_de_la_Paix_Paris.jpg');
  assert.equal(data.geo_batiment_valide, 'oui');
  assert.ok(data.geo_entreprise && JSON.parse(data.geo_entreprise).company_location.city === 'Paris');

  dom.window.close();
});

test('Google Sheets : champs plats géo ajoutés, colonnes existantes intactes', () => {
  const dom = envWithLead();
  fillGeoState(dom.window);
  const sheet = dom.window.lpLead.googleSheetPreview();

  assert.equal(sheet.form_id, 'ADW_LP_ASSURANCE_TNS_PRO');
  assert.equal(sheet.source, 'ADW_test');
  assert.equal(sheet.ltm_typ, 'merci-test');
  assert.equal(sheet.geo_adresse, '12 Rue de la Paix 75002 Paris');
  assert.equal(sheet.geo_latitude, '48.8566');
  assert.equal(sheet.geo_batiment_image_source, 'Wikimedia Commons');
  assert.equal(sheet.geo_localisation_validee, 'oui');
  assert.ok(sheet.geo_entreprise.length <= 8000, 'JSON borné pour une cellule Sheets');
  /* champs métier existants toujours présents (vides ici) */
  ['nom', 'prenom', 'mail', 'telephone', 'societe', 'code_postal', 'solution', 'enjeu']
    .forEach((k) => assert.ok(k in sheet, `colonne existante manquante : ${k}`));
  dom.window.close();
});

test('sans données géo : le lead part avec les statuts du module, sans pollution', () => {
  const dom = envWithLead();
  const data = dom.window.lpLead.preview().payload.data;
  assert.equal(data.geo_entreprise_module.company_location.status, 'empty');
  assert.equal(data.geo_statut_localisation, 'empty');
  assert.equal(data.geo_adresse, undefined, 'pas de champ adresse vide');
  assert.equal(data.geo_batiment_image_url, undefined);
  assert.equal(data.ltm_source, 'ADW_test', 'tracking inchangé');
  dom.window.close();
});

test('dégradation gracieuse : lead-handler fonctionne SANS le module géo', () => {
  const dom = envWithLead({ geo: false });
  assert.equal(dom.window.cpGeo, undefined);
  const preview = dom.window.lpLead.preview();
  assert.equal(preview.payload.data.geo_entreprise_module, undefined);
  assert.equal(preview.payload.data.geo_adresse, undefined);
  assert.equal(preview.payload.data.ltm_source, 'ADW_test');
  const sheet = dom.window.lpLead.googleSheetPreview();
  assert.equal(sheet.geo_adresse, undefined);
  dom.window.close();
});

test('sans consentement cookies : tracking filtré, données géo toujours transmises', () => {
  const dom = envWithLead({ consent: false });
  fillGeoState(dom.window);
  const data = dom.window.lpLead.preview().payload.data;
  assert.equal(data.ltm_source, undefined, 'paramètres de campagne filtrés sans consentement');
  assert.equal(data.source, 'LP TNS PRO', 'source de secours conservée');
  assert.equal(data.geo_adresse, '12 Rue de la Paix 75002 Paris',
    'la géo fait partie du formulaire, pas du tracking publicitaire');
  dom.window.close();
});

test('lpLead.getLeadId exposé et identifiant stable', async () => {
  const dom = envWithLead();
  const id1 = dom.window.lpLead.getLeadId();
  assert.ok(id1 && id1.length >= 8);
  assert.equal(id1, dom.window.lpLead.preview().payload.id);
  fillGeoState(dom.window);
  await tick(5);
  assert.equal(dom.window.cpGeo.getData().lead_id, id1, 'le module géo partage l’identifiant du lead');
  dom.window.close();
});

test('aucun événement dataLayer ajouté par le module (conversions intactes)', () => {
  const dom = envWithLead();
  const before = (dom.window.dataLayer || []).filter((e) => e && e.event).map((e) => e.event);
  fillGeoState(dom.window);
  const after = (dom.window.dataLayer || []).filter((e) => e && e.event).map((e) => e.event);
  assert.deepEqual(after, before, 'valider une localisation/image ne pousse aucun événement');
  dom.window.close();
});

test('champs CRM existants non modifiés : comparaison avec/sans module', () => {
  const domSans = envWithLead({ geo: false });
  const domAvec = envWithLead({ geo: true });
  const dataSans = domSans.window.lpLead.preview().payload.data;
  fillGeoState(domAvec.window);
  const dataAvec = domAvec.window.lpLead.preview().payload.data;

  Object.keys(dataSans).forEach((key) => {
    assert.deepEqual(dataAvec[key], dataSans[key],
      `champ existant modifié par le module : ${key}`);
  });
  domSans.window.close();
  domAvec.window.close();
});
