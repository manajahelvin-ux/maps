/* Helpers de test — environnement jsdom reproduisant la landing page
   (aucun appel réseau réel : fetch est routé vers des fixtures). */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LP_DIR = path.resolve(HERE, '../..');

export const GEO_FILES = [
  'geo/cp-geo-core.js',
  'geo/cp-geo-geocoding.js',
  'geo/cp-geo-images.js',
  'geo/cp-geo-ui.js',
  'geo/cp-geo-init.js'
];

/* ---------------- Fixtures géocodage ---------------- */
export const BAN_FIXTURE = {
  type: 'FeatureCollection',
  features: [
    {
      geometry: { coordinates: [2.3522, 48.8566] },
      properties: {
        label: '12 Rue de la Paix 75002 Paris', score: 0.99,
        housenumber: '12', street: 'Rue de la Paix', name: '12 Rue de la Paix',
        postcode: '75002', citycode: '75102', city: 'Paris',
        context: '75, Paris, Île-de-France', type: 'housenumber'
      }
    },
    {
      geometry: { coordinates: [2.3308, 48.8543] },
      properties: {
        label: 'Rue de la Paix 75002 Paris', score: 0.7,
        street: 'Rue de la Paix', name: 'Rue de la Paix',
        postcode: '75002', city: 'Paris', context: '75, Paris', type: 'street'
      }
    },
    {
      geometry: { coordinates: [2.3488, 48.8534] },
      properties: {
        label: 'Paris', score: 0.5, name: 'Paris',
        postcode: '75000', city: 'Paris', context: '75, Paris', type: 'municipality'
      }
    },
    {
      geometry: { coordinates: [2.3522, 48.8566] },
      properties: {
        label: '12 Rue de la Paix 75002 Paris', score: 0.99,
        housenumber: '12', street: 'Rue de la Paix',
        postcode: '75002', city: 'Paris', type: 'housenumber'
      }
    }
  ]
};

export const BAN_REVERSE_FIXTURE = {
  type: 'FeatureCollection',
  features: [{
    geometry: { coordinates: [2.3510, 48.8570] },
    properties: {
      label: '3 Rue de la Michodière 75002 Paris', score: 0.9,
      housenumber: '3', street: 'Rue de la Michodière',
      postcode: '75002', city: 'Paris', type: 'housenumber'
    }
  }]
};

export const NOMINATIM_FIXTURE = [
  {
    place_id: 1, osm_type: 'way', osm_id: 111,
    lat: '50.84660', lon: '4.35280',
    display_name: 'Galerie de la Reine, Rue Royale, Bruxelles, 1000, Belgique',
    addresstype: 'building', importance: 0.6,
    address: {
      road: 'Rue Royale', postcode: '1000', city: 'Bruxelles',
      country: 'Belgique', country_code: 'be'
    }
  },
  {
    place_id: 2, osm_type: 'node', osm_id: 222,
    lat: '50.85000', lon: '4.35000',
    display_name: 'Boulangerie Dupont, Rue Neuve, Bruxelles, 1000, Belgique',
    addresstype: 'commercial', importance: 0.4,
    address: {
      house_number: '25', road: 'Rue Neuve', postcode: '1000', city: 'Bruxelles',
      country: 'Belgique', country_code: 'be'
    }
  }
];

export const NOMINATIM_REVERSE_FIXTURE = {
  place_id: 9, lat: '48.85700', lon: '2.35100',
  display_name: '3 Rue de la Michodière, 75002 Paris, France',
  addresstype: 'building',
  address: {
    house_number: '3', road: 'Rue de la Michodière', postcode: '75002',
    city: 'Paris', country: 'France', country_code: 'fr'
  }
};

export const COMMONS_FIXTURE = {
  batchcomplete: '',
  query: {
    pages: {
      '101': {
        pageid: 101, title: 'File:Immeuble 12 rue de la Paix Paris.jpg', index: 1,
        coordinates: [{ lat: 48.85661, lon: 2.35225, dist: 12, primary: '' }],
        imageinfo: [{
          url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Immeuble_12_rue_de_la_Paix_Paris.jpg',
          thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Immeuble_12_rue_de_la_Paix_Paris.jpg/720px-Immeuble_12_rue_de_la_Paix_Paris.jpg',
          width: 3000, height: 2000, mime: 'image/jpeg',
          extmetadata: {
            LicenseShortName: { value: 'CC BY-SA 4.0' },
            Artist: { value: '<a href="//example.com">Jean&nbsp;Dupont</a>' },
            ImageDescription: { value: 'Façade de l’immeuble.' }
          }
        }]
      },
      '102': {
        pageid: 102, title: 'File:Place Vendome depuis rue de la Paix.jpg', index: 2,
        coordinates: [{ lat: 48.85800, lon: 2.35400, dist: 300, primary: '' }],
        imageinfo: [{
          url: 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Place_Vendome.jpg',
          thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Place_Vendome.jpg/720px-Place_Vendome.jpg',
          width: 2000, height: 1500, mime: 'image/jpeg',
          extmetadata: { LicenseShortName: { value: 'CC BY 3.0' }, Artist: { value: 'Marie Martin' } }
        }]
      },
      '103': {
        pageid: 103, title: 'File:Carte de Paris 1889.png', index: 3,
        coordinates: [{ lat: 48.8566, lon: 2.3522, dist: 5, primary: '' }],
        imageinfo: [{
          url: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Carte_de_Paris.png',
          thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Carte_de_Paris.png/720px-Carte_de_Paris.png',
          width: 1200, height: 900, mime: 'image/png', extmetadata: {}
        }]
      },
      '104': {
        pageid: 104, title: 'File:Minuscule icone.jpg', index: 4,
        coordinates: [{ lat: 48.8566, lon: 2.3522, dist: 3, primary: '' }],
        imageinfo: [{
          url: 'https://upload.wikimedia.org/wikipedia/commons/1/11/tiny.jpg',
          thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/tiny.jpg/720px-tiny.jpg',
          width: 120, height: 80, mime: 'image/jpeg', extmetadata: {}
        }]
      },
      '105': {
        pageid: 105, title: 'File:Photo hote suspect.jpg', index: 5,
        coordinates: [{ lat: 48.8566, lon: 2.3522, dist: 8, primary: '' }],
        imageinfo: [{
          url: 'https://evil.example.com/photo.jpg',
          thumburl: 'https://evil.example.com/photo_t.jpg',
          width: 1600, height: 1200, mime: 'image/jpeg', extmetadata: {}
        }]
      }
    }
  }
};

export const COMMONS_EMPTY_FIXTURE = { batchcomplete: '', query: { pages: {} } };

/* ---------------- Environnement jsdom ---------------- */
export function createDom({ url, cookies } = {}) {
  const html = fs.readFileSync(path.join(LP_DIR, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: url || 'https://assurance-tns-pro-v2-adw.lp.comparateurpro.fr/?ltm_source=ADW_test&ltm_category=cat_test&ltm_typ=merci-test',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  if (cookies) dom.window.document.cookie = cookies;
  dom.window.fetchCalls = [];
  return dom;
}

/* Routeur fetch : aucun appel réseau réel ne sort des tests. */
export function installFetchStub(window, handlers = {}) {
  const routes = Object.assign({
    'api-adresse.data.gouv.fr/search': () => json(BAN_FIXTURE),
    'api-adresse.data.gouv.fr/reverse': () => json(BAN_REVERSE_FIXTURE),
    'nominatim.openstreetmap.org/search': () => json(NOMINATIM_FIXTURE),
    'nominatim.openstreetmap.org/reverse': () => json(NOMINATIM_REVERSE_FIXTURE),
    'commons.wikimedia.org': () => json(COMMONS_FIXTURE)
  }, handlers);

  window.fetch = function (input, init) {
    const url = String(input && input.url ? input.url : input);
    window.fetchCalls.push({ url, init });
    for (const key of Object.keys(routes)) {
      if (url.includes(key)) {
        try { return Promise.resolve(routes[key](new URL(url), init)); }
        catch (e) { return Promise.reject(e); }
      }
    }
    return Promise.resolve(json({ error: 'route non stubbée : ' + url }, 404));
  };

  function json(body, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body))
    };
  }
}

export function loadScripts(window, files, { preConfig } = {}) {
  if (preConfig) window.CP_GEO_CONFIG = preConfig;
  for (const f of files) {
    window.eval(fs.readFileSync(path.join(LP_DIR, f), 'utf8'));
  }
}

export function loadGeo(window, opts) {
  loadScripts(window, GEO_FILES, opts);
}

export function tick(ms = 0) {
  return new Promise((r) => setTimeout(r, ms));
}
