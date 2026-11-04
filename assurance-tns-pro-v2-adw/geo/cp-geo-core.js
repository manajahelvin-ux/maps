/* =====================================================================
   cp-geo-core.js — Module "Localisation et identification de
   l'entreprise" (ComparateurPro — assurance-tns-pro-v2-adw)
   ---------------------------------------------------------------------
   Noyau : configuration, utilitaires, état des deux blocs indépendants
   (A = localisation, B = bâtiment), persistance sessionStorage et
   synchronisation vers un champ caché du formulaire de leads.

   Namespace global : window.CPGeo
   Surcharge de configuration (avant chargement) : window.CP_GEO_CONFIG

   Aucune clé API privée n'est utilisée côté client : les fournisseurs
   par défaut (BAN, Nominatim/OSM, Wikimedia Commons, Esri World
   Imagery) fonctionnent sans clé. Les fournisseurs à clé (Google
   Street View, Mapillary…) passent par un proxy serveur à configurer
   (voir GEO-MODULE.md).
   ===================================================================== */
(function (window) {
  'use strict';

  var CPGeo = window.CPGeo = window.CPGeo || {};
  var VERSION = '1.0.0';

  /* ============================ Configuration ============================ */
  var DEFAULT_CONFIG = {
    version: VERSION,
    /* --- Périmètre géographique --- */
    defaultCountry: 'FR',
    countries: [
      { code: 'FR', label: 'France' },
      { code: 'BE', label: 'Belgique' },
      { code: 'LU', label: 'Luxembourg' },
      { code: 'CH', label: 'Suisse' },
      { code: 'DE', label: 'Allemagne' },
      { code: 'ES', label: 'Espagne' },
      { code: 'IT', label: 'Italie' },
      { code: 'NL', label: 'Pays-Bas' },
      { code: 'PT', label: 'Portugal' },
      { code: 'AT', label: 'Autriche' },
      { code: 'IE', label: 'Irlande' },
      { code: 'PL', label: 'Pologne' },
      { code: 'SE', label: 'Suède' },
      { code: 'DK', label: 'Danemark' },
      { code: 'FI', label: 'Finlande' },
      { code: 'GR', label: 'Grèce' },
      { code: 'CZ', label: 'Tchéquie' },
      { code: 'RO', label: 'Roumanie' },
      { code: 'HU', label: 'Hongrie' },
      { code: 'SK', label: 'Slovaquie' },
      { code: 'SI', label: 'Slovénie' },
      { code: 'HR', label: 'Croatie' },
      { code: 'BG', label: 'Bulgarie' },
      { code: 'EE', label: 'Estonie' },
      { code: 'LV', label: 'Lettonie' },
      { code: 'LT', label: 'Lituanie' },
      { code: 'NO', label: 'Norvège' },
      { code: 'GB', label: 'Royaume-Uni' }
    ],

    /* --- Géocodage France : Base Adresse Nationale (api.gouv.fr) --- */
    ban: {
      searchUrl: 'https://api-adresse.data.gouv.fr/search/',
      reverseUrl: 'https://api-adresse.data.gouv.fr/reverse/',
      enabled: true
    },
    /* --- Géocodage Europe : Nominatim / OpenStreetMap --- */
    nominatim: {
      searchUrl: 'https://nominatim.openstreetmap.org/search',
      reverseUrl: 'https://nominatim.openstreetmap.org/reverse',
      enabled: true,
      minIntervalMs: 1100,   /* politique OSM : max 1 requête/seconde */
      limit: 8
    },

    /* --- Cartographie (fonds Leaflet) --- */
    map: {
      osmTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      osmAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      esriImageryTileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      esriAttribution: 'Imagerie &copy; Esri, Maxar, Earthstar Geographics et la communauté GIS',
      defaultZoom: 17,
      mapPreviewZoom: 16,
      staticTileZoom: 17      /* zoom de la tuile enregistrée comme aperçu */
    },

    /* --- Photographies de bâtiments --- */
    images: {
      commonsApiUrl: 'https://commons.wikimedia.org/w/api.php',
      photoSearchRadiusM: 250,     /* rayon de recherche autour du point */
      photoMaxReliableDistanceM: 60, /* au-delà : avertissement "vérifiez" */
      thumbWidth: 720,
      providers: ['wikimedia-commons', 'esri-aerial'],
      /* Fournisseurs à clé via proxy serveur (facultatif, désactivés par
         défaut — ne jamais mettre de clé API dans le JavaScript public) :
         streetViewProxy: 'https://votre-serveur/streetview-proxy.php',
         mapillaryProxy:  'https://votre-serveur/mapillary-proxy.php'   */
      streetViewProxy: '',
      mapillaryProxy: ''
    },

    /* --- Réseau --- */
    fetchTimeoutMs: 9000,

    /* --- Persistance --- */
    storageKey: 'cp_geo_module_v1',
    hiddenFieldName: 'geo_json',
    maxHistoryEntries: 40,

    /* --- Tracking : AUCUN événement dataLayer ajouté par défaut.
           La conversion reste liée à la soumission du formulaire.
           Passer à true pour pousser des événements d'usage neutres
           (geo_search, geo_location_validated…) sans déclencheur GTM. --- */
    pushDataLayerEvents: false,

    /* --- Débogage --- */
    debug: false
  };

  function mergeDeep(target, source) {
    Object.keys(source || {}).forEach(function (key) {
      var v = source[key];
      if (v && typeof v === 'object' && !Array.isArray(v) &&
          target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        mergeDeep(target[key], v);
      } else {
        target[key] = v;
      }
    });
    return target;
  }

  CPGeo.config = mergeDeep(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), window.CP_GEO_CONFIG || {});

  function log() {
    if (CPGeo.config.debug && window.console && console.log) {
      console.log.apply(console, ['[cp-geo]'].concat([].slice.call(arguments)));
    }
  }
  CPGeo.log = log;

  /* ============================ Utilitaires ============================ */
  function uuid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (e) { /* ancien navigateur */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  function nowIso() { return new Date().toISOString(); }

  function cleanText(value, limit) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit || 300);
  }

  function roundCoord(value) {
    var n = parseFloat(value);
    if (!isFinite(n)) return null;
    return Math.round(n * 1e6) / 1e6;   /* ~0,11 m de précision, format WGS84 */
  }

  function clampLat(n) { return Math.max(-90, Math.min(90, n)); }
  function clampLon(n) { return Math.max(-180, Math.min(180, n)); }

  /* Distance haversine en mètres (WGS84, rayon moyen terrestre) */
  function distanceM(lat1, lon1, lat2, lon2) {
    var R = 6371008.8;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Validation stricte des URL fournies/renvoyées (RGPD + anti-injection) */
  var ALLOWED_IMAGE_HOSTS = [
    'upload.wikimedia.org', 'commons.wikimedia.org',
    'server.arcgisonline.com', 'services.arcgisonline.com',
    'tile.openstreetmap.org', 'a.tile.openstreetmap.org', 'b.tile.openstreetmap.org', 'c.tile.openstreetmap.org',
    'nominatim.openstreetmap.org', 'api-adresse.data.gouv.fr',
    'www.openstreetmap.org', 'openstreetmap.org',
    'maps.googleapis.com', 'mapillary.com', 'scontent.mapillary.com'
  ];
  function isAllowedUrl(raw, extraHosts) {
    try {
      var url = new URL(String(raw || ''));
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
      var hosts = ALLOWED_IMAGE_HOSTS.concat(extraHosts || []);
      var host = url.hostname.toLowerCase();
      for (var i = 0; i < hosts.length; i++) {
        if (host === hosts[i] || host.slice(-('.' + hosts[i]).length) === '.' + hosts[i]) return true;
      }
      /* Proxy serveur configuré par l'exploitant (même origine ou explicite) */
      try {
        if (url.origin === window.location.origin) return true;
      } catch (e) { /* noop */ }
      return false;
    } catch (e) { return false; }
  }

  /* fetch JSON avec délai maximal + AbortController */
  function fetchJson(url, options) {
    var opts = options || {};
    var timeout = opts.timeoutMs || CPGeo.config.fetchTimeoutMs;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? window.setTimeout(function () { controller.abort(); }, timeout) : null;
    var init = {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      signal: controller ? controller.signal : undefined,
      credentials: 'omit'
    };
    return fetch(url, init).then(function (response) {
      if (!response.ok) {
        var err = new Error('HTTP ' + response.status);
        err.httpStatus = response.status;
        throw err;
      }
      return response.json();
    }).finally(function () { if (timer) window.clearTimeout(timer); });
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      if (t) window.clearTimeout(t);
      t = window.setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  /* Traduction code ISO -> nom français (et inverse, tolérant aux accents) */
  function countryLabel(code) {
    var list = CPGeo.config.countries;
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i].label;
    return code || '';
  }
  function countryCode(labelOrCode) {
    var s = cleanText(labelOrCode).toLowerCase();
    if (!s) return '';
    var list = CPGeo.config.countries;
    for (var i = 0; i < list.length; i++) {
      if (list[i].code.toLowerCase() === s || list[i].label.toLowerCase() === s) return list[i].code;
    }
    if (/^[a-z]{2}$/.test(s)) return s.toUpperCase();
    return '';
  }
  function stripAccents(s) {
    try { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
    catch (e) { return String(s || ''); }
  }

  CPGeo.utils = {
    uuid: uuid, nowIso: nowIso, cleanText: cleanText, roundCoord: roundCoord,
    clampLat: clampLat, clampLon: clampLon, distanceM: distanceM,
    escapeHtml: escapeHtml, isAllowedUrl: isAllowedUrl, fetchJson: fetchJson,
    debounce: debounce, countryLabel: countryLabel, countryCode: countryCode,
    stripAccents: stripAccents
  };

  /* ============================ État du module ============================ */
  var STATUS = {
    EMPTY: 'empty',                       /* Non renseigné */
    SEARCHING: 'searching',               /* Recherche en cours */
    FOUND: 'found',                       /* Résultat trouvé */
    PENDING: 'pending',                   /* En attente de validation */
    VALIDATED: 'validated',               /* Validé */
    ERROR: 'error',                       /* Erreur */
    IMAGE_UNAVAILABLE: 'image_unavailable' /* Image indisponible */
  };
  CPGeo.STATUS = STATUS;

  function emptyLocation() {
    return {
      status: STATUS.EMPTY,
      search_id: '',
      company_name: '',
      address: '', street: '', house_number: '',
      postal_code: '', city: '',
      country: '', country_code: '',
      latitude: null, longitude: null,
      map_url: '',                 /* référence de carte (permalink OSM) */
      map_image_url: '',           /* aperçu cartographique (tuile OSM) */
      map_provider: '',            /* source cartographique */
      geocode_source: '',          /* BAN | Nominatim/OSM */
      geocode_result_type: '',     /* housenumber | street | locality | municipality… */
      searched_at: '',
      validated: false,
      validated_at: '',
      last_error: ''
    };
  }
  function emptyBuilding() {
    return {
      status: STATUS.EMPTY,
      search_id: '',
      address: '', postal_code: '', city: '',
      country: '', country_code: '',
      latitude: null, longitude: null,
      building_image_url: '',      /* URL de référence de l'image choisie */
      building_image_thumb_url: '',
      image_source: '',            /* fournisseur */
      image_type: '',              /* photo_exterieure | satellite | street_view | aerial */
      image_license: '',
      image_author: '',
      image_page_url: '',
      image_distance_m: null,      /* distance image <-> point adresse */
      aerial_image_url: '',        /* vue aérienne/satellite associée */
      aerial_provider: '',
      searched_at: '',
      validated: false,
      validated_at: '',
      last_error: '',
      no_image_reason: ''
    };
  }

  var state = {
    module_version: VERSION,
    lead_id: '',
    created_at: nowIso(),
    updated_at: nowIso(),
    company_location: emptyLocation(),
    company_building: emptyBuilding(),
    history: []   /* traçabilité : recherches, validations, erreurs */
  };

  function sanitizeBlock(base, incoming) {
    /* Ne copie que les clés connues du bloc : aucune donnée inattendue
       ne peut être injectée dans l'état (contrôle des entrées). */
    var out = {};
    Object.keys(base).forEach(function (key) {
      out[key] = (incoming && Object.prototype.hasOwnProperty.call(incoming, key))
        ? incoming[key] : base[key];
    });
    if (typeof out.latitude !== 'number' && out.latitude !== null) out.latitude = roundCoord(out.latitude);
    if (typeof out.longitude !== 'number' && out.longitude !== null) out.longitude = roundCoord(out.longitude);
    ['address', 'street', 'house_number', 'postal_code', 'city', 'country', 'country_code',
     'company_name', 'map_url', 'map_image_url', 'map_provider', 'geocode_source',
     'geocode_result_type', 'building_image_url', 'building_image_thumb_url', 'image_source',
     'image_type', 'image_license', 'image_author', 'image_page_url', 'aerial_image_url',
     'aerial_provider', 'last_error', 'no_image_reason', 'status', 'search_id'].forEach(function (key) {
      if (out[key] != null && typeof out[key] === 'string') out[key] = cleanText(out[key], 1000);
    });
    return out;
  }

  function addHistory(entry) {
    try {
      state.history.push(Object.assign({ at: nowIso() }, entry));
      if (state.history.length > CPGeo.config.maxHistoryEntries) {
        state.history = state.history.slice(state.history.length - CPGeo.config.maxHistoryEntries);
      }
    } catch (e) { log('history error', e); }
  }

  /* ---- Persistance (sessionStorage) — survit aux rechargements et aux
         changements d'étape, sans dépendre uniquement du DOM. ---- */
  function persist() {
    state.updated_at = nowIso();
    try {
      window.sessionStorage.setItem(CPGeo.config.storageKey, JSON.stringify(state));
    } catch (e) { log('sessionStorage indisponible', e); }
    syncHiddenField();
    CPGeo.emit && CPGeo.emit('statechange', { state: CPGeo.getData() });
  }
  function restore() {
    var raw = '';
    try { raw = window.sessionStorage.getItem(CPGeo.config.storageKey) || ''; } catch (e) { return false; }
    if (!raw) return false;
    try {
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return false;
      if (saved.company_location) {
        state.company_location = sanitizeBlock(emptyLocation(), saved.company_location);
      }
      if (saved.company_building) {
        state.company_building = sanitizeBlock(emptyBuilding(), saved.company_building);
      }
      if (Array.isArray(saved.history)) state.history = saved.history.slice(-CPGeo.config.maxHistoryEntries);
      if (saved.lead_id) state.lead_id = cleanText(saved.lead_id, 64);
      if (saved.created_at) state.created_at = cleanText(saved.created_at, 40);
      return true;
    } catch (e) { log('état restauré invalide', e); return false; }
  }

  /* ---- Champ caché du formulaire : les données voyagent avec le DOM
         du formulaire (sauvegarde de secours côté lead-handler). ---- */
  function syncHiddenField() {
    try {
      var form = document.querySelector('form[data-ubepro-lead="1"]');
      if (!form) return;
      var field = form.querySelector('input[name="' + CPGeo.config.hiddenFieldName + '"]');
      if (!field) {
        field = document.createElement('input');
        field.type = 'hidden';
        field.name = CPGeo.config.hiddenFieldName;
        form.appendChild(field);
      }
      field.value = JSON.stringify(getPublicData());
    } catch (e) { log('sync champ caché impossible', e); }
  }

  /* ---- Événements internes (bus minimal) ---- */
  var listeners = {};
  CPGeo.on = function (name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
  };
  CPGeo.emit = function (name, detail) {
    (listeners[name] || []).forEach(function (fn) {
      try { fn(detail); } catch (e) { log('listener error', name, e); }
    });
  };

  /* ============================ API d'état ============================ */
  function leadId() {
    /* Identifiant du lead : celui du gestionnaire de leads si exposé,
       sinon identifiant local stable (fusionné au lead à la soumission). */
    if (!state.lead_id) {
      try {
        if (window.lpLead && typeof window.lpLead.getLeadId === 'function') {
          state.lead_id = String(window.lpLead.getLeadId() || '');
        }
      } catch (e) { /* noop */ }
      if (!state.lead_id) state.lead_id = 'geo-' + uuid();
    }
    return state.lead_id;
  }

  function getPublicData() {
    return JSON.parse(JSON.stringify({
      module_version: state.module_version,
      search_id: state.company_location.search_id || state.company_building.search_id || '',
      lead_id: leadId(),
      created_at: state.created_at,
      updated_at: state.updated_at,
      company_location: state.company_location,
      company_building: state.company_building,
      history: state.history
    }));
  }

  CPGeo.getData = getPublicData;
  CPGeo.leadId = leadId;
  CPGeo.persist = persist;
  CPGeo.restore = restore;
  CPGeo.addHistory = function (entry) { addHistory(entry); persist(); };

  CPGeo.getLocation = function () { return JSON.parse(JSON.stringify(state.company_location)); };
  CPGeo.getBuilding = function () { return JSON.parse(JSON.stringify(state.company_building)); };

  /* Les deux blocs sont strictement indépendants : setLocation ne touche
     jamais company_building et inversement.
     Toute modification de position/adresse d'un bloc VALIDÉ retire
     automatiquement la validation (sauf demande explicite) : une donnée
     validée ne peut pas devenir obsolète silencieusement. */
  function autoUnvalidate(current, partial, positionKeys) {
    if (!partial || current.validated !== true || partial.validated === true) return partial;
    var touches = positionKeys.some(function (key) { return key in partial; });
    if (!touches) return partial;
    var changed = positionKeys.some(function (key) {
      return key in partial && partial[key] !== current[key];
    });
    return changed ? Object.assign({ validated: false, validated_at: '' }, partial) : partial;
  }

  CPGeo.setLocation = function (partial, opts) {
    partial = autoUnvalidate(state.company_location, partial || {},
      ['latitude', 'longitude', 'address']);
    state.company_location = sanitizeBlock(emptyLocation(),
      Object.assign({}, state.company_location, partial));
    if (!(opts && opts.silent)) addHistory(Object.assign({ block: 'company_location', action: 'update' }, opts && opts.log || {}));
    persist();
    return CPGeo.getLocation();
  };
  CPGeo.setBuilding = function (partial, opts) {
    partial = autoUnvalidate(state.company_building, partial || {},
      ['latitude', 'longitude', 'address', 'building_image_url']);
    state.company_building = sanitizeBlock(emptyBuilding(),
      Object.assign({}, state.company_building, partial));
    if (!(opts && opts.silent)) addHistory(Object.assign({ block: 'company_building', action: 'update' }, opts && opts.log || {}));
    persist();
    return CPGeo.getBuilding();
  };

  CPGeo.validateLocation = function () {
    var loc = state.company_location;
    if (loc.latitude == null || loc.longitude == null || !loc.address) return null;
    loc.validated = true;
    loc.validated_at = nowIso();
    loc.status = STATUS.VALIDATED;
    loc.last_error = '';
    addHistory({ block: 'company_location', action: 'validate', lat: loc.latitude, lon: loc.longitude });
    persist();
    return CPGeo.getLocation();
  };
  CPGeo.validateBuilding = function () {
    var b = state.company_building;
    if (b.latitude == null || b.longitude == null || !b.building_image_url) return null;
    b.validated = true;
    b.validated_at = nowIso();
    b.status = STATUS.VALIDATED;
    b.last_error = '';
    addHistory({ block: 'company_building', action: 'validate', image_source: b.image_source, image_type: b.image_type });
    persist();
    return CPGeo.getBuilding();
  };
  CPGeo.unvalidateLocation = function () {
    state.company_location.validated = false;
    state.company_location.validated_at = '';
    if (state.company_location.status === STATUS.VALIDATED) state.company_location.status = STATUS.FOUND;
    addHistory({ block: 'company_location', action: 'unvalidate' });
    persist();
  };
  CPGeo.unvalidateBuilding = function () {
    state.company_building.validated = false;
    state.company_building.validated_at = '';
    if (state.company_building.status === STATUS.VALIDATED) state.company_building.status = STATUS.FOUND;
    addHistory({ block: 'company_building', action: 'unvalidate' });
    persist();
  };
  CPGeo.reset = function () {
    state.company_location = emptyLocation();
    state.company_building = emptyBuilding();
    state.history = [];
    addHistory({ block: 'module', action: 'reset' });
    persist();
  };

  /* ============================ Payload CRM ============================
     Deux formats fournis (capacités CRM variables) :
     1. `geo_entreprise` : objet JSON structuré (company_location /
        company_building conformes à la spécification) ;
     2. champs plats `geo_*` : compatibles Google Sheets / champs CRM
        individuels.
     ================================================================= */
  function boolFr(v) { return v ? 'oui' : 'non'; }

  CPGeo.getLeadPayload = function () {
    var loc = state.company_location;
    var b = state.company_building;
    var structured = {
      module_version: state.module_version,
      search_id: loc.search_id || b.search_id || '',
      lead_id: leadId(),
      company_location: {
        company_name: loc.company_name,
        address: loc.address,
        postal_code: loc.postal_code,
        city: loc.city,
        country: loc.country,
        latitude: loc.latitude,
        longitude: loc.longitude,
        map_image_url: loc.map_image_url,
        map_url: loc.map_url,
        map_provider: loc.map_provider,
        geocode_source: loc.geocode_source,
        status: loc.status,
        validated: !!loc.validated,
        validated_at: loc.validated_at || null,
        searched_at: loc.searched_at || null
      },
      company_building: {
        address: b.address,
        postal_code: b.postal_code,
        city: b.city,
        country: b.country,
        latitude: b.latitude,
        longitude: b.longitude,
        building_image_url: b.building_image_url,
        image_source: b.image_source,
        image_type: b.image_type,
        image_license: b.image_license,
        image_author: b.image_author,
        image_page_url: b.image_page_url,
        image_distance_m: b.image_distance_m,
        aerial_image_url: b.aerial_image_url,
        aerial_provider: b.aerial_provider,
        status: b.status,
        validated: !!b.validated,
        validated_at: b.validated_at || null,
        searched_at: b.searched_at || null,
        no_image_reason: b.no_image_reason || null,
        last_error: b.last_error || null
      }
    };
    var flat = {
      geo_entreprise: JSON.stringify(structured),
      geo_recherche_id: structured.search_id,
      geo_statut_localisation: loc.status,
      geo_adresse: loc.address,
      geo_code_postal: loc.postal_code,
      geo_ville: loc.city,
      geo_pays: loc.country,
      geo_latitude: loc.latitude == null ? '' : String(loc.latitude),
      geo_longitude: loc.longitude == null ? '' : String(loc.longitude),
      geo_carte_url: loc.map_url,
      geo_carte_image_url: loc.map_image_url,
      geo_carte_source: loc.map_provider,
      geo_geocodage_source: loc.geocode_source,
      geo_localisation_validee: boolFr(loc.validated),
      geo_localisation_validee_le: loc.validated_at,
      geo_statut_batiment: b.status,
      geo_batiment_adresse: b.address,
      geo_batiment_code_postal: b.postal_code,
      geo_batiment_ville: b.city,
      geo_batiment_pays: b.country,
      geo_batiment_latitude: b.latitude == null ? '' : String(b.latitude),
      geo_batiment_longitude: b.longitude == null ? '' : String(b.longitude),
      geo_batiment_image_url: b.building_image_url,
      geo_batiment_image_source: b.image_source,
      geo_batiment_image_type: b.image_type,
      geo_batiment_image_licence: b.image_license,
      geo_batiment_image_auteur: b.image_author,
      geo_batiment_image_page: b.image_page_url,
      geo_batiment_image_distance_m: b.image_distance_m == null ? '' : String(b.image_distance_m),
      geo_batiment_vue_aerienne_url: b.aerial_image_url,
      geo_batiment_vue_aerienne_source: b.aerial_provider,
      geo_batiment_valide: boolFr(b.validated),
      geo_batiment_valide_le: b.validated_at,
      geo_batiment_sans_image_motif: b.no_image_reason
    };
    /* Nettoyer les valeurs vides des champs plats (payload CRM allégé) */
    Object.keys(flat).forEach(function (k) {
      if (flat[k] === '' || flat[k] == null) delete flat[k];
    });
    return { structured: structured, flat: flat };
  };

  /* ---- dataLayer (désactivé par défaut : aucune conversion artificielle) */
  CPGeo.track = function (event, payload) {
    if (!CPGeo.config.pushDataLayerEvents) return;
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(Object.assign({ event: event, geo_module_version: VERSION }, payload || {}));
    } catch (e) { /* noop */ }
  };

  CPGeo.version = VERSION;
})(window);
