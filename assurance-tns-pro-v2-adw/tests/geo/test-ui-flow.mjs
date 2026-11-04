/* Test 6 — Parcours utilisateur complet dans jsdom :
   montage des blocs, modale de recherche localisation (BAN), sélection
   d'un résultat, validation, modale bâtiment sans photo (message
   explicite + repli vue aérienne), indépendance des blocs, erreurs,
   rechargement de page. Leaflet n'est pas exécuté (jsdom ne charge pas
   les scripts externes) : le chemin « carte indisponible » est couvert. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDom, installFetchStub, loadGeo, loadScripts, tick,
  COMMONS_EMPTY_FIXTURE, BAN_FIXTURE
} from './helpers.mjs';

function env(handlers) {
  const dom = createDom();
  installFetchStub(dom.window, handlers);
  loadScripts(dom.window, ['lead-handler.js']);
  loadGeo(dom.window, { preConfig: { nominatim: { minIntervalMs: 5 } } });
  return dom;
}
/* accepte une window OU un élément comme racine de recherche */
const q = (scope, sel) => (scope.document || scope).querySelector(sel);
const qa = (scope, sel) => [...(scope.document || scope).querySelectorAll(sel)];

function buttonByText(scope, text) {
  return [...scope.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text));
}

test('montage : deux blocs distincts, états vides, boutons Valider désactivés', async () => {
  const dom = env();
  await tick(30);
  const win = dom.window;
  assert.equal(qa(win, '.cpgeo-block').length, 2);
  const badges = qa(win, '.cpgeo-badge').map((b) => b.textContent);
  assert.deepEqual(badges, ['Non renseigné', 'Non renseigné']);
  qa(win, '.cpgeo-btn-primary').forEach((b) => assert.equal(b.disabled, true));
  /* aucun input visible dans l'étape (contrainte Formly) */
  const step = q(win, '[data-answer="geo-entreprise"]').closest('[data-form="step"]');
  assert.equal(step.querySelectorAll('input, select, textarea').length, 0);
  dom.window.close();
});

test('bloc A : recherche modale → résultat → validation (BAN)', async () => {
  const dom = env();
  await tick(30);
  const win = dom.window;

  /* préremplissage depuis les champs société / code postal du formulaire */
  q(win, 'input[name="societe"]').value = 'Boulangerie Dupont';
  q(win, 'input[name="code_postal"]').value = '75002';

  win.CPGeo.ui._openLocationModal(null);
  await tick(20);
  const overlay = q(win, '.cpgeo-modal-overlay.cpgeo-open');
  assert.ok(overlay, 'modale ouverte');
  assert.match(overlay.textContent, /Rechercher la localisation/);
  assert.equal(q(overlay, 'input[name="cpgeo_company"]').value, 'Boulangerie Dupont');
  assert.equal(q(overlay, 'input[name="cpgeo_postal"]').value, '75002');
  assert.equal(q(overlay, 'select[name="cpgeo_country"]').value, 'FR', 'pays par défaut : France');

  q(overlay, 'input[name="cpgeo_street"]').value = '12 rue de la Paix';
  q(overlay, 'input[name="cpgeo_city"]').value = 'Paris';
  buttonByText(overlay, 'Lancer la recherche').click();
  await tick(60);

  const items = qa(overlay, '.cpgeo-result-item');
  assert.ok(items.length >= 2, `résultats affichés (${items.length})`);
  assert.ok(items[0].classList.contains('cpgeo-selected'), 'meilleur résultat présélectionné');
  assert.match(overlay.textContent, /BAN \(Base Adresse Nationale\)/, 'source affichée');

  const confirm = buttonByText(overlay, 'Utiliser cette localisation');
  assert.equal(confirm.disabled, false);
  confirm.click();
  await tick(20);
  assert.equal(q(win, '.cpgeo-modal-overlay.cpgeo-open'), null, 'modale fermée');

  /* bloc A mis à jour */
  const state = win.cpGeo.getLocation();
  assert.equal(state.status, 'found');
  assert.equal(state.address, '12 Rue de la Paix 75002 Paris');
  assert.equal(state.latitude, 48.8566);
  assert.equal(state.map_provider, 'OpenStreetMap');
  assert.match(state.map_url, /openstreetmap\.org/);
  assert.match(state.map_image_url, /tile\.openstreetmap\.org/);
  const badgeA = qa(win, '.cpgeo-badge')[0];
  assert.match(badgeA.textContent, /Résultat trouvé/);

  /* bouton Valider actif puis validation */
  const valider = qa(win, '.cpgeo-block')[0].querySelector('.cpgeo-btn-primary');
  assert.equal(valider.disabled, false);
  valider.click();
  await tick(10);
  assert.equal(win.cpGeo.getLocation().validated, true);
  assert.match(qa(win, '.cpgeo-badge')[0].textContent, /Localisation validée le/);
  assert.ok(q(win, '.cpgeo-message-success'));

  /* bloc B strictement inchangé */
  const b = win.cpGeo.getBuilding();
  assert.equal(b.status, 'empty');
  assert.equal(b.latitude, null);
  assert.match(qa(win, '.cpgeo-badge')[1].textContent, /Non renseigné/);
  dom.window.close();
});

test('bloc A : adresse introuvable → message explicite, pas de blocage', async () => {
  const dom = env({
    'api-adresse.data.gouv.fr/search': () => ({ ok: true, status: 200, json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }) }),
    'nominatim.openstreetmap.org/search': () => ({ ok: true, status: 200, json: () => Promise.resolve([]) })
  });
  await tick(30);
  const win = dom.window;
  win.CPGeo.ui._openLocationModal(null);
  const overlay = q(win, '.cpgeo-modal-overlay.cpgeo-open');
  overlay.querySelector('input[name="cpgeo_street"]').value = '1 rue Inexistante';
  overlay.querySelector('input[name="cpgeo_city"]').value = 'Nowhere';
  buttonByText(overlay, 'Lancer la recherche').click();
  await tick(60);
  assert.match(overlay.textContent, /Aucune adresse trouvée/, 'message utilisateur explicite');
  assert.equal(qa(overlay, '.cpgeo-result-item').length, 0);
  /* le module reste utilisable : rien n'est écrit dans l'état */
  assert.equal(win.cpGeo.getLocation().address, '');
  dom.window.close();
});

test('bloc A : erreur réseau → statut erreur affiché sur le bloc', async () => {
  const dom = env({
    'api-adresse.data.gouv.fr/search': () => ({ ok: false, status: 503, json: () => Promise.resolve({}) }),
    'nominatim.openstreetmap.org/search': () => ({ ok: false, status: 503, json: () => Promise.resolve({}) })
  });
  await tick(30);
  const win = dom.window;
  win.CPGeo.ui._openLocationModal(null);
  const overlay = q(win, '.cpgeo-modal-overlay.cpgeo-open');
  overlay.querySelector('input[name="cpgeo_street"]').value = '12 rue de la Paix';
  overlay.querySelector('input[name="cpgeo_city"]').value = 'Paris';
  buttonByText(overlay, 'Lancer la recherche').click();
  await tick(80);
  assert.equal(win.cpGeo.getLocation().status, 'error');
  buttonByText(overlay, 'Annuler').click();
  await tick(10);
  assert.match(qa(win, '.cpgeo-badge')[0].textContent, /Erreur/);
  assert.ok(q(win, '.cpgeo-block .cpgeo-message-error'));
  dom.window.close();
});

test('bloc B : aucune photo → message explicite + repli vue aérienne sélectionnable', async () => {
  const dom = env({ 'commons.wikimedia.org': () => ({ ok: true, status: 200, json: () => Promise.resolve(COMMONS_EMPTY_FIXTURE) }) });
  await tick(30);
  const win = dom.window;

  win.CPGeo.ui._openBuildingModal(null);
  const overlay = q(win, '.cpgeo-modal-overlay.cpgeo-open');
  overlay.querySelector('input[name="cpgeo_street"]').value = '12 rue de la Paix';
  overlay.querySelector('input[name="cpgeo_postal"]').value = '75002';
  overlay.querySelector('input[name="cpgeo_city"]').value = 'Paris';
  buttonByText(overlay, 'Lancer la recherche').click();
  await tick(120);

  assert.ok(q(overlay, '.cpgeo-no-image'), 'message « aucune photographie fiable »');
  assert.match(overlay.textContent, /Aucune photographie fiable du bâtiment/);
  assert.match(overlay.textContent, /image générique/, 'la règle métier est expliquée');

  const cards = qa(overlay, '.cpgeo-photo-card');
  assert.equal(cards.length, 1, 'seule la vue aérienne est proposée');
  assert.match(cards[0].textContent, /Vue satellite/);
  cards[0].click();
  await tick(10);
  const confirm = buttonByText(overlay, 'Utiliser cette image');
  assert.equal(confirm.disabled, false);
  confirm.click();
  await tick(20);

  const b = win.cpGeo.getBuilding();
  assert.equal(b.status, 'pending');
  assert.equal(b.image_type, 'satellite');
  assert.equal(b.image_source, 'Esri World Imagery');
  assert.match(b.building_image_url, /arcgisonline\.com/);
  assert.equal(b.validated, false);

  /* validation dans le bloc */
  const valider = qa(win, '.cpgeo-block')[1].querySelector('.cpgeo-btn-primary');
  assert.equal(valider.disabled, false);
  valider.click();
  await tick(10);
  assert.equal(win.cpGeo.getBuilding().validated, true);
  assert.match(qa(win, '.cpgeo-badge')[1].textContent, /Bâtiment validé le/);

  /* bloc A untouched */
  assert.equal(win.cpGeo.getLocation().status, 'empty');
  dom.window.close();
});

test('bloc B : photo Commons trouvée → sélection avec distance, source et licence', async () => {
  const dom = env();
  await tick(30);
  const win = dom.window;
  /* localisation d'abord validée (préremplissage du bloc B) */
  win.CPGeo.setLocation({
    address: '12 Rue de la Paix 75002 Paris', house_number: '12', street: 'Rue de la Paix',
    postal_code: '75002', city: 'Paris', country: 'France', country_code: 'FR',
    latitude: 48.8566, longitude: 2.3522, status: 'found'
  });
  win.CPGeo.validateLocation();

  win.CPGeo.ui._openBuildingModal(null);
  const overlay = q(win, '.cpgeo-modal-overlay.cpgeo-open');
  assert.equal(overlay.querySelector('input[name="cpgeo_street"]').value, '12 Rue de la Paix', 'prérempli depuis bloc A');
  assert.equal(overlay.querySelector('input[name="cpgeo_postal"]').value, '75002');
  buttonByText(overlay, 'Lancer la recherche').click();
  await tick(150);

  const cards = qa(overlay, '.cpgeo-photo-card');
  assert.ok(cards.length >= 2, 'photos + vue aérienne affichées');
  const photo = cards[0];
  assert.match(photo.textContent, /Photo extérieure/);
  assert.match(photo.textContent, /12 m/, 'distance affichée');
  assert.match(photo.textContent, /Wikimedia Commons/);
  assert.match(photo.textContent, /CC BY-SA 4\.0/, 'licence affichée');
  assert.match(photo.textContent, /Jean Dupont/, 'auteur affiché');
  const far = cards.find((c) => /300 m/.test(c.textContent));
  assert.ok(far && /vérifiez/i.test(far.textContent), 'avertissement si distance > seuil');

  photo.click();
  await tick(10);
  buttonByText(overlay, 'Utiliser cette image').click();
  await tick(20);
  const b = win.cpGeo.getBuilding();
  assert.equal(b.image_type, 'photo_exterieure');
  assert.equal(b.image_distance_m, 12);
  assert.match(b.image_page_url, /commons\.wikimedia\.org/);
  assert.match(q(win, '.cpgeo-photo-caption').textContent, /Source :/);
  assert.ok(q(win, '.cpgeo-aerial-row img'), 'vignette vue aérienne dans le bloc');
  dom.window.close();
});

test('rechargement de page : état validé restauré et affiché', async () => {
  const dom = env();
  await tick(30);
  const win = dom.window;
  win.CPGeo.setLocation({ address: '12 Rue de la Paix 75002 Paris', postal_code: '75002', city: 'Paris', country: 'France', country_code: 'FR', latitude: 48.8566, longitude: 2.3522, map_url: 'https://www.openstreetmap.org/?mlat=48.856600&mlon=2.352200', map_image_url: 'https://tile.openstreetmap.org/17/66392/45092.png', map_provider: 'OpenStreetMap', geocode_source: 'BAN', status: 'found' });
  win.CPGeo.validateLocation();
  const saved = win.sessionStorage.getItem('cp_geo_module_v1');
  assert.ok(saved);
  dom.window.close();

  /* second contexte = page rechargée avec même sessionStorage */
  const dom2 = env();
  dom2.window.sessionStorage.setItem('cp_geo_module_v1', saved);
  dom2.window.CPGeo.restore();
  dom2.window.CPGeo.ui.renderAll();
  await tick(30);
  assert.equal(dom2.window.cpGeo.getLocation().validated, true);
  assert.match(qa(dom2.window, '.cpgeo-badge')[0].textContent, /Localisation validée le/);
  assert.match(q(dom2.window, '.cpgeo-info').textContent, /12 Rue de la Paix/);
  assert.equal(qa(dom2.window, '.cpgeo-block')[0].querySelector('.cpgeo-btn-primary').disabled, false);
  dom2.window.close();
});

test('modifier une localisation validée ne perd pas la photo du bâtiment', async () => {
  const dom = env();
  await tick(30);
  const win = dom.window;
  win.CPGeo.setLocation({ address: 'A1', latitude: 48.85, longitude: 2.35, status: 'found' });
  win.CPGeo.validateLocation();
  win.CPGeo.setBuilding({
    address: 'A1', latitude: 48.85, longitude: 2.35,
    building_image_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg',
    image_source: 'Wikimedia Commons', image_type: 'photo_exterieure', status: 'pending'
  });
  win.CPGeo.validateBuilding();

  /* nouvelle recherche de localisation (correction) */
  win.CPGeo.setLocation({ address: 'A2 corrigée', latitude: 48.86, longitude: 2.36, status: 'found' });
  assert.equal(win.cpGeo.getLocation().validated, false, 'localisation à revalider');
  const b = win.cpGeo.getBuilding();
  assert.equal(b.validated, true, 'le bâtiment validé est conservé tel quel');
  assert.equal(b.building_image_url, 'https://upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg');
  dom.window.close();
});

test('accessibilité : modale en dialog, focus géré, ESC ferme', async () => {
  const dom = env();
  await tick(30);
  const win = dom.window;
  win.CPGeo.ui._openLocationModal(null);
  await tick(80);
  const overlay = q(win, '.cpgeo-modal-overlay.cpgeo-open');
  const dialog = q(overlay, '[role="dialog"]');
  assert.ok(dialog);
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.ok(dialog.getAttribute('aria-labelledby'));

  const esc = new win.KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true });
  win.document.dispatchEvent(esc);
  await tick(20);
  assert.equal(q(win, '.cpgeo-modal-overlay.cpgeo-open'), null, 'ESC ferme la modale');
  assert.equal(win.document.body.style.overflow, '', 'scroll du corps restauré');
  dom.window.close();
});

test('anti-doublon : la même recherche ne repasse pas par le réseau', async () => {
  const dom = env();
  await tick(30);
  const win = dom.window;
  win.CPGeo.ui._openLocationModal(null);
  const overlay = q(win, '.cpgeo-modal-overlay.cpgeo-open');
  overlay.querySelector('input[name="cpgeo_street"]').value = '12 rue de la Paix';
  overlay.querySelector('input[name="cpgeo_postal"]').value = '75002';
  overlay.querySelector('input[name="cpgeo_city"]').value = 'Paris';
  buttonByText(overlay, 'Lancer la recherche').click();
  await tick(80);
  const callsAfterFirst = win.fetchCalls.filter((c) => /api-adresse/.test(c.url)).length;
  buttonByText(overlay, 'Annuler').click();
  await tick(10);
  win.CPGeo.ui._openLocationModal(null);
  const overlay2 = q(win, '.cpgeo-modal-overlay.cpgeo-open');
  overlay2.querySelector('input[name="cpgeo_street"]').value = '12 rue de la Paix';
  overlay2.querySelector('input[name="cpgeo_postal"]').value = '75002';
  overlay2.querySelector('input[name="cpgeo_city"]').value = 'Paris';
  buttonByText(overlay2, 'Lancer la recherche').click();
  await tick(80);
  const callsAfterSecond = win.fetchCalls.filter((c) => /api-adresse/.test(c.url)).length;
  assert.equal(callsAfterSecond, callsAfterFirst, 'résultats servis depuis le cache de session');
  dom.window.close();
});

/* ------- Régression bloc B : conservation / écrasement de la sélection ------- */

const PARIS_BUILDING = {
  address: '12 Rue de la Paix 75002 Paris', postal_code: '75002', city: 'Paris',
  country: 'France', country_code: 'FR', latitude: 48.8566, longitude: 2.3522,
  building_image_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Immeuble_12_rue_de_la_Paix_Paris.jpg',
  building_image_thumb_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Immeuble_12_rue_de_la_Paix_Paris.jpg/720px-Immeuble_12_rue_de_la_Paix_Paris.jpg',
  image_source: 'Wikimedia Commons', image_type: 'photo_exterieure',
  image_license: 'CC BY-SA 4.0', image_author: 'Jean Dupont',
  image_page_url: 'https://commons.wikimedia.org/wiki/File:Immeuble_12_rue_de_la_Paix_Paris.jpg',
  image_distance_m: 12, status: 'pending'
};

test('bloc B : nouvelle recherche à la même adresse conserve la sélection validée', async () => {
  const dom = env();
  await tick(30);
  const win = dom.window;
  win.CPGeo.setLocation({
    address: '12 Rue de la Paix 75002 Paris', house_number: '12', street: 'Rue de la Paix',
    postal_code: '75002', city: 'Paris', country: 'France', country_code: 'FR',
    latitude: 48.8566, longitude: 2.3522, status: 'found'
  });
  win.CPGeo.validateLocation();

  /* première recherche : photo Commons sélectionnée puis validée */
  win.CPGeo.ui._openBuildingModal(null);
  let overlay = q(win, '.cpgeo-modal-overlay.cpgeo-open');
  buttonByText(overlay, 'Lancer la recherche').click();
  await tick(150);
  qa(overlay, '.cpgeo-photo-card')[0].click();
  await tick(10);
  buttonByText(overlay, 'Utiliser cette image').click();
  await tick(20);
  qa(win, '.cpgeo-block')[1].querySelector('.cpgeo-btn-primary').click();
  await tick(10);
  assert.equal(win.cpGeo.getBuilding().validated, true, 'bâtiment validé');
  const photoUrl = win.cpGeo.getBuilding().building_image_url;
  assert.match(photoUrl, /upload\.wikimedia\.org/);

  /* seconde recherche avec les mêmes champs : point résolu identique */
  win.CPGeo.ui._openBuildingModal(null);
  overlay = q(win, '.cpgeo-modal-overlay.cpgeo-open');
  assert.equal(overlay.querySelector('input[name="cpgeo_street"]').value, '12 Rue de la Paix');
  buttonByText(overlay, 'Lancer la recherche').click();
  await tick(150);

  const b = win.cpGeo.getBuilding();
  assert.equal(b.validated, true, 'la validation précédente est conservée');
  assert.equal(b.status, 'validated');
  assert.equal(b.building_image_url, photoUrl, 'la photo choisie est conservée');
  assert.match(qa(win, '.cpgeo-badge')[1].textContent, /Bâtiment validé le/);
  assert.ok(q(win, '.cpgeo-photo-caption'), 'la légende de la photo reste affichée dans le bloc');
  assert.ok(qa(overlay, '.cpgeo-photo-card').length >= 2, 'la galerie reste proposée pour un autre choix');
  dom.window.close();
});

test('bloc B : recherche à une autre adresse efface la photo précédente', async () => {
  const BAN_LYON = {
    type: 'FeatureCollection',
    features: [{
      geometry: { coordinates: [4.8357, 45.7640] },
      properties: {
        label: '1 Rue de la République 69002 Lyon', score: 0.97,
        housenumber: '1', street: 'Rue de la République',
        postcode: '69002', city: 'Lyon', context: '69, Rhône, Auvergne-Rhône-Alpes', type: 'housenumber'
      }
    }]
  };
  const dom = env({
    'api-adresse.data.gouv.fr/search': (url) => (url.searchParams.get('postcode') === '69002'
      ? { ok: true, status: 200, json: () => Promise.resolve(BAN_LYON) }
      : { ok: true, status: 200, json: () => Promise.resolve(BAN_FIXTURE) })
  });
  await tick(30);
  const win = dom.window;

  /* sélection précédente validée à Paris */
  win.CPGeo.setBuilding(Object.assign({}, PARIS_BUILDING));
  win.CPGeo.validateBuilding();
  assert.equal(win.cpGeo.getBuilding().validated, true);

  /* nouvelle recherche à Lyon */
  win.CPGeo.ui._openBuildingModal(null);
  const overlay = q(win, '.cpgeo-modal-overlay.cpgeo-open');
  overlay.querySelector('input[name="cpgeo_street"]').value = '1 rue de la République';
  overlay.querySelector('input[name="cpgeo_postal"]').value = '69002';
  overlay.querySelector('input[name="cpgeo_city"]').value = 'Lyon';
  buttonByText(overlay, 'Lancer la recherche').click();
  await tick(180);

  const b = win.cpGeo.getBuilding();
  assert.equal(b.latitude, 45.764);
  assert.equal(b.longitude, 4.8357);
  assert.equal(b.address, '1 Rue de la République 69002 Lyon');
  assert.equal(b.postal_code, '69002');
  assert.equal(b.city, 'Lyon');
  assert.equal(b.status, 'found');
  assert.equal(b.validated, false, 'nouvelle adresse : la validation est remise à zéro');
  assert.equal(b.building_image_url, '', 'la photo parisienne ne correspond plus : effacée');
  assert.equal(b.image_source, '');
  assert.equal(b.image_license, '');
  assert.equal(q(win, '.cpgeo-photo-caption'), null, 'plus de légende dans le bloc');
  assert.match(qa(win, '.cpgeo-badge')[1].textContent, /Résultat trouvé/);
  assert.ok(qa(overlay, '.cpgeo-photo-card').length >= 2, 'une nouvelle galerie est proposée');
  dom.window.close();
});

test('bloc B : aucune nouvelle photo à la même adresse, sélection précédente conservée', async () => {
  const dom = env({ 'commons.wikimedia.org': () => ({ ok: true, status: 200, json: () => Promise.resolve(COMMONS_EMPTY_FIXTURE) }) });
  await tick(30);
  const win = dom.window;
  win.CPGeo.setBuilding(Object.assign({}, PARIS_BUILDING));
  win.CPGeo.validateBuilding();

  win.CPGeo.ui._openBuildingModal(null);
  const overlay = q(win, '.cpgeo-modal-overlay.cpgeo-open');
  overlay.querySelector('input[name="cpgeo_street"]').value = '12 rue de la Paix';
  overlay.querySelector('input[name="cpgeo_postal"]').value = '75002';
  overlay.querySelector('input[name="cpgeo_city"]').value = 'Paris';
  buttonByText(overlay, 'Lancer la recherche').click();
  await tick(150);

  assert.ok(q(overlay, '.cpgeo-no-image'), 'message explicite affiché');
  assert.match(overlay.textContent, /sélection précédente est conservée/);
  const b = win.cpGeo.getBuilding();
  assert.equal(b.validated, true, 'la validation est conservée (même adresse)');
  assert.equal(b.status, 'validated');
  assert.match(b.building_image_url, /upload\.wikimedia\.org/, 'photo précédente intacte');
  assert.match(b.no_image_reason, /sélection précédente/);
  assert.match(qa(win, '.cpgeo-badge')[1].textContent, /Bâtiment validé le/);
  const cards = qa(overlay, '.cpgeo-photo-card');
  assert.equal(cards.length, 1, 'seul le repli vue aérienne est proposé');
  assert.match(cards[0].textContent, /Vue satellite/);
  dom.window.close();
});
