/* =====================================================================
   cp-geo-ui.js — Interface du module géolocalisation
   ---------------------------------------------------------------------
   Construit les deux blocs indépendants (A : localisation, B :
   bâtiment), leurs fenêtres modales de recherche, les cartes Leaflet
   (chargées à la demande) et la sélection des photographies.

   Règles d'intégration respectées :
   - aucun <input> visible dans l'étape du formulaire (le moteur
     Formly ne doit pas désactiver le bouton « Suivant ») : les champs
     de recherche vivent dans des modales rattachées au <body> ;
   - tous les boutons du module sont type="button" (jamais submit) ;
   - les deux blocs ont des états strictement séparés.
   ===================================================================== */
(function (window, document) {
  'use strict';

  var CPGeo = window.CPGeo = window.CPGeo || {};
  var cfg = CPGeo.config;
  var utils = CPGeo.utils;
  var log = CPGeo.log;
  var STATUS = CPGeo.STATUS;

  /* Chemin de base du module (déduit du <script> courant au chargement) */
  var basePath = (function () {
    try {
      var s = document.currentScript ||
        document.querySelector('script[src*="cp-geo-ui.js"]');
      if (s && s.src) {
        return s.src.split('/').slice(0, -1).join('/') + '/';
      }
    } catch (e) { /* noop */ }
    return 'geo/';
  })();
  CPGeo.basePath = basePath;

  /* ============================ Icônes ============================ */
  var ICONS = {
    pin: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0072cc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>',
    building: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0072cc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="1"></rect><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3"></path></svg>',
    search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"></path></svg>'
  };

  /* ============================ Helpers DOM ============================ */
  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html != null) node.innerHTML = html;
    return node;
  }
  function qs(scope, sel) { return (scope || document).querySelector(sel); }

  var BADGE_LABELS = {};
  BADGE_LABELS[STATUS.EMPTY] = 'Non renseigné';
  BADGE_LABELS[STATUS.SEARCHING] = 'Recherche en cours…';
  BADGE_LABELS[STATUS.FOUND] = 'Résultat trouvé';
  BADGE_LABELS[STATUS.PENDING] = 'En attente de validation';
  BADGE_LABELS[STATUS.VALIDATED] = 'Validé';
  BADGE_LABELS[STATUS.ERROR] = 'Erreur';
  BADGE_LABELS[STATUS.IMAGE_UNAVAILABLE] = 'Image indisponible';

  var BADGE_CLASSES = {};
  BADGE_CLASSES[STATUS.EMPTY] = 'cpgeo-badge-empty';
  BADGE_CLASSES[STATUS.SEARCHING] = 'cpgeo-badge-searching';
  BADGE_CLASSES[STATUS.FOUND] = 'cpgeo-badge-found';
  BADGE_CLASSES[STATUS.PENDING] = 'cpgeo-badge-pending';
  BADGE_CLASSES[STATUS.VALIDATED] = 'cpgeo-badge-validated';
  BADGE_CLASSES[STATUS.ERROR] = 'cpgeo-badge-error';
  BADGE_CLASSES[STATUS.IMAGE_UNAVAILABLE] = 'cpgeo-badge-no-image';

  var IMAGE_TYPE_LABELS = {
    photo_exterieure: 'Photo extérieure',
    satellite: 'Vue satellite',
    aerial: 'Vue aérienne',
    street_view: 'Vue de rue'
  };
  var RESULT_TYPE_LABELS = {
    housenumber: 'n° de rue',
    street: 'rue',
    locality: 'lieu-dit',
    municipality: 'commune',
    city: 'ville',
    town: 'ville',
    village: 'village',
    building: 'bâtiment',
    commercial: 'commercial',
    office: 'bureaux',
    company: 'entreprise',
    poi: 'point d’intérêt',
    address: 'adresse'
  };

  function formatCoord(v) { return v == null ? '—' : Number(v).toFixed(6); }
  function formatDate(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('fr-FR') + ' à ' +
        d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }

  /* ============================ Leaflet (à la demande) ============================ */
  var leafletPromise = null;
  function ensureLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = basePath + 'leaflet/leaflet.css';
      document.head.appendChild(link);

      var script = document.createElement('script');
      script.src = basePath + 'leaflet/leaflet.js';
      script.defer = true;
      script.onload = function () {
        if (!window.L) { reject(new Error('Leaflet introuvable après chargement.')); return; }
        try { window.L.Icon.Default.imagePath = basePath + 'leaflet/images/'; } catch (e) { /* noop */ }
        resolve(window.L);
      };
      script.onerror = function () { reject(new Error('Impossible de charger le composant cartographique.')); };
      document.head.appendChild(script);
    });
    return leafletPromise;
  }

  function createMap(container, opts) {
    return ensureLeaflet().then(function (L) {
      var map = L.map(container, {
        zoomControl: true,
        scrollWheelZoom: !!(opts && opts.scrollWheelZoom),
        attributionControl: true
      });
      L.tileLayer(cfg.map.osmTileUrl, {
        maxZoom: 19,
        attribution: cfg.map.osmAttribution
      }).addTo(map);
      if (opts && opts.satelliteLayer) {
        L.tileLayer(cfg.map.esriImageryTileUrl, {
          maxZoom: 19,
          attribution: cfg.map.esriAttribution
        }).addTo(map);
      }
      return map;
    });
  }

  /* ============================ Messages ============================ */
  function showMessage(node, type, text) {
    if (!node) return;
    node.className = 'cpgeo-message cpgeo-message-' + type + ' cpgeo-visible';
    node.textContent = text;
    node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  }
  function hideMessage(node) {
    if (!node) return;
    node.className = 'cpgeo-message';
    node.textContent = '';
  }

  /* ============================ Modale générique ============================ */
  var openModals = [];
  function Modal(options) {
    var self = this;
    this.opener = options.opener || null;
    this.overlay = el('div', 'cpgeo-modal-overlay');
    var dialog = el('div', 'cpgeo-modal');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    var titleId = 'cpgeo-modal-title-' + utils.uuid().slice(0, 8);
    dialog.setAttribute('aria-labelledby', titleId);

    var head = el('div', 'cpgeo-modal-head');
    var headText = el('div');
    headText.appendChild(el('div', 'cpgeo-modal-title', utils.escapeHtml(options.title || '')));
    headText.id = titleId;
    if (options.subtitle) headText.appendChild(el('div', 'cpgeo-modal-sub', utils.escapeHtml(options.subtitle)));
    var closeBtn = el('button', 'cpgeo-modal-close', '&times;');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Fermer');
    head.appendChild(headText);
    head.appendChild(closeBtn);

    this.body = el('div', 'cpgeo-modal-body');
    this.foot = el('div', 'cpgeo-modal-foot');

    dialog.appendChild(head);
    dialog.appendChild(this.body);
    dialog.appendChild(this.foot);
    this.overlay.appendChild(dialog);
    this.element = dialog;

    closeBtn.addEventListener('click', function () { self.close(); });
    this.overlay.addEventListener('mousedown', function (e) {
      if (e.target === self.overlay) self.close();
    });
    this.onKeyDown = function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) { e.stopPropagation(); self.close(); }
      if ((e.key === 'Tab' || e.keyCode === 9)) {
        /* piégeage simple du focus */
        var focusables = self.element.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        var list = Array.prototype.filter.call(focusables, function (n) {
          return !n.disabled && n.getClientRects().length > 0;
        });
        if (!list.length) return;
        var first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    /* Empêcher la touche Entrée de déclencher le « Suivant » du formulaire */
    this.overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.keyCode === 13) {
        var t = e.target;
        if (t && t.tagName === 'INPUT' && t.type !== 'button' && t.type !== 'submit') {
          e.preventDefault();
          e.stopPropagation();
          if (typeof options.onEnter === 'function') options.onEnter();
        }
      }
    });
    document.body.appendChild(this.overlay);
  }
  Modal.prototype.open = function () {
    var self = this;
    this.overlay.classList.add('cpgeo-open');
    document.body.style.overflow = 'hidden';
    openModals.push(this);
    document.addEventListener('keydown', this.onKeyDown, true);
    window.setTimeout(function () {
      var first = self.element.querySelector('input:not([type=hidden]), button.cpgeo-btn');
      if (first) first.focus();
    }, 60);
  };
  Modal.prototype.close = function () {
    var idx = openModals.indexOf(this);
    if (idx !== -1) openModals.splice(idx, 1);
    if (!openModals.length) document.body.style.overflow = '';
    document.removeEventListener('keydown', this.onKeyDown, true);
    try { this.overlay.remove(); } catch (e) { /* noop */ }
    if (this.opener && this.opener.focus) this.opener.focus();
  };
  Modal.prototype.addButton = function (label, className, onClick, attrs) {
    var btn = el('button', 'cpgeo-btn ' + (className || 'cpgeo-btn-primary'), utils.escapeHtml(label));
    btn.type = 'button';
    Object.keys(attrs || {}).forEach(function (k) { btn.setAttribute(k, attrs[k]); });
    btn.addEventListener('click', onClick);
    this.foot.appendChild(btn);
    return btn;
  };
  Modal.prototype.setBusy = function (busy) {
    var buttons = this.foot.querySelectorAll('button');
    Array.prototype.forEach.call(buttons, function (b) { b.disabled = !!busy; });
  };

  /* ============================ Champ de formulaire (modales) ============================ */
  function field(def) {
    var wrap = el('label', 'cpgeo-field' + (def.full ? ' cpgeo-full' : ''));
    wrap.appendChild(el('span', 'cpgeo-field-label', utils.escapeHtml(def.label)));
    var input;
    if (def.type === 'select') {
      input = el('select', 'cpgeo-select');
      (def.options || []).forEach(function (opt) {
        var o = el('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.selected) o.selected = true;
        input.appendChild(o);
      });
    } else {
      input = el('input', 'cpgeo-input');
      input.type = def.type || 'text';
      input.placeholder = def.placeholder || '';
      input.value = def.value || '';
      if (def.maxlength) input.maxLength = def.maxlength;
      if (def.autocomplete) input.autocomplete = def.autocomplete;
      if (def.inputmode) input.inputMode = def.inputmode;
    }
    input.name = 'cpgeo_' + def.name;   /* préfixe : hors des noms du lead */
    wrap.appendChild(input);
    if (def.hint) wrap.appendChild(el('span', 'cpgeo-field-hint', utils.escapeHtml(def.hint)));
    wrap._input = input;
    return wrap;
  }

  /* ============================ État UI local ============================ */
  var ui = {
    mounted: false,
    root: null,
    stepEl: null,
    blocks: {},           /* { location: {...refs}, building: {...refs} } */
    locationMap: null,    /* { map, marker } */
    buildingMap: null,
    stepVisible: false,
    lastSearchCache: {}   /* anti-doublons : query -> résultats */
  };
  CPGeo.ui = CPGeo.ui || {};

  /* ============================ Bloc A : localisation ============================ */
  function buildLocationBlock(container) {
    var refs = {};
    var block = el('section', 'cpgeo-block');
    block.setAttribute('data-cpgeo-block-ui', 'location');

    var head = el('div', 'cpgeo-block-head');
    var title = el('div', 'cpgeo-block-title', ICONS.pin + ' <span>Localisation de l’entreprise</span>');
    refs.badge = el('span', 'cpgeo-badge cpgeo-badge-empty', BADGE_LABELS[STATUS.EMPTY]);
    refs.badge.setAttribute('aria-live', 'polite'); /* accessibilité */
    head.appendChild(title);
    head.appendChild(refs.badge);
    block.appendChild(head);
    block.appendChild(el('div', 'cpgeo-block-sub',
      'Recherchez puis vérifiez l’emplacement exact de votre entreprise. Vous pouvez déplacer le marqueur sur la carte pour ajuster la position.'));

    refs.mapContainer = el('div', 'cpgeo-map');
    refs.mapContainer.appendChild(el('div', 'cpgeo-map-placeholder',
      'Carte chargée à la demande<br>Utilisez « Rechercher » pour localiser votre entreprise'));
    block.appendChild(refs.mapContainer);

    refs.info = el('div', 'cpgeo-info');
    block.appendChild(refs.info);

    refs.message = el('div', 'cpgeo-message');
    block.appendChild(refs.message);

    var actions = el('div', 'cpgeo-actions');
    refs.validateBtn = el('button', 'cpgeo-btn cpgeo-btn-primary', ICONS.check + ' <span>Valider</span>');
    refs.validateBtn.type = 'button';
    refs.searchBtn = el('button', 'cpgeo-btn cpgeo-btn-secondary', ICONS.search + ' <span>Rechercher</span>');
    refs.searchBtn.type = 'button';
    actions.appendChild(refs.validateBtn);
    actions.appendChild(refs.searchBtn);
    block.appendChild(actions);

    refs.block = block;
    refs.validateBtn.addEventListener('click', function () { onValidateLocation(refs); });
    refs.searchBtn.addEventListener('click', function () { openLocationModal(refs.searchBtn); });

    container.appendChild(block);
    return refs;
  }

  function infoRow(label, value, opts) {
    var row = el('div', 'cpgeo-info-row' + (opts && opts.full ? ' cpgeo-full' : ''));
    row.appendChild(el('span', 'cpgeo-info-label', utils.escapeHtml(label) + ' :'));
    var valueNode = el('span', 'cpgeo-info-value' + (opts && opts.mono ? ' cpgeo-info-mono' : ''),
      opts && opts.html ? value : utils.escapeHtml(value));
    row.appendChild(valueNode);
    return row;
  }

  function renderLocationBlock() {
    var refs = ui.blocks.location;
    if (!refs) return;
    var loc = CPGeo.getLocation();

    refs.badge.className = 'cpgeo-badge ' + (BADGE_CLASSES[loc.status] || 'cpgeo-badge-empty');
    refs.badge.textContent = loc.status === STATUS.VALIDATED && loc.validated_at
      ? 'Localisation validée le ' + formatDate(loc.validated_at)
      : (BADGE_LABELS[loc.status] || loc.status);
    refs.block.classList.toggle('cpgeo-validated', !!loc.validated);

    refs.info.innerHTML = '';
    if (loc.latitude == null && !loc.address) {
      refs.info.appendChild(el('div', 'cpgeo-empty-note cpgeo-full',
        'Aucune localisation enregistrée pour le moment. Cliquez sur « Rechercher ».'));
    } else {
      if (loc.company_name) refs.info.appendChild(infoRow('Entreprise', loc.company_name, { full: true }));
      refs.info.appendChild(infoRow('Adresse', loc.address || '—', { full: true }));
      refs.info.appendChild(infoRow('Code postal', loc.postal_code || '—'));
      refs.info.appendChild(infoRow('Ville', loc.city || '—'));
      refs.info.appendChild(infoRow('Pays', loc.country || '—'));
      refs.info.appendChild(infoRow('Latitude', formatCoord(loc.latitude), { mono: true }));
      refs.info.appendChild(infoRow('Longitude', formatCoord(loc.longitude), { mono: true }));
      refs.info.appendChild(infoRow('Géocodage', loc.geocode_source || '—'));
      if (loc.map_url) {
        refs.info.appendChild(infoRow('Carte',
          '<a href="' + utils.escapeHtml(loc.map_url) + '" target="_blank" rel="noopener noreferrer">Voir sur OpenStreetMap</a>',
          { html: true }));
      }
    }

    /* Bouton Valider : actif seulement si des coordonnées + adresse existent */
    var canValidate = loc.latitude != null && loc.longitude != null && !!loc.address;
    refs.validateBtn.disabled = !canValidate;
    var labelSpan = qs(refs.validateBtn, 'span');
    if (labelSpan) {
      labelSpan.textContent = loc.validated ? 'Valider à nouveau' : 'Valider';
    }

    updateLocationMap(loc);

    if (loc.status === STATUS.ERROR && loc.last_error) showMessage(refs.message, 'error', loc.last_error);
    else if (loc.validated) showMessage(refs.message, 'success',
      'Localisation confirmée et associée à votre demande' + (loc.validated_at ? ' le ' + formatDate(loc.validated_at) : '') + '.');
    else if (loc.status === STATUS.FOUND && loc.address) showMessage(refs.message, 'info',
      'Adresse trouvée. Vérifiez la position sur la carte puis cliquez sur « Valider ».');
    else hideMessage(refs.message);
  }

  function updateLocationMap(loc) {
    var refs = ui.blocks.location;
    if (!refs || !ui.stepVisible) return;
    if (loc.latitude == null || loc.longitude == null) return;
    ensureLeaflet().then(function () {
      if (!ui.locationMap) {
        refs.mapContainer.innerHTML = '';
        return createMap(refs.mapContainer, { scrollWheelZoom: false }).then(function (map) {
          var marker = window.L.marker([loc.latitude, loc.longitude], { draggable: true }).addTo(map);
          marker.on('dragend', function () {
            var pos = marker.getLatLng();
            onLocationMarkerMoved(pos.lat, pos.lng);
          });
          ui.locationMap = { map: map, marker: marker };
          map.setView([loc.latitude, loc.longitude], cfg.map.defaultZoom);
          window.setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 220);
        });
      }
      var m = ui.locationMap;
      m.marker.setLatLng([loc.latitude, loc.longitude]);
      m.map.setView([loc.latitude, loc.longitude], Math.max(m.map.getZoom(), cfg.map.mapPreviewZoom));
      window.setTimeout(function () { try { m.map.invalidateSize(); } catch (e) {} }, 60);
      return null;
    }).catch(function (e) {
      log('carte localisation indisponible', e);
      if (!qs(refs.mapContainer, '.cpgeo-map-placeholder')) {
        refs.mapContainer.innerHTML = '';
        refs.mapContainer.appendChild(el('div', 'cpgeo-map-placeholder',
          'Carte indisponible pour le moment.<br>Les coordonnées GPS restent enregistrées.'));
      }
    });
  }

  function onLocationMarkerMoved(lat, lon) {
    var loc = CPGeo.getLocation();
    lat = utils.roundCoord(lat);
    lon = utils.roundCoord(lon);
    CPGeo.setLocation({ latitude: lat, longitude: lon, status: STATUS.FOUND, validated: false, validated_at: '' },
      { log: { action: 'marker_drag' } });
    /* Géocodage inverse pour mettre à jour l'adresse (tolérant aux échecs) */
    CPGeo.geocoding.reverse(lat, lon, loc.country_code || cfg.defaultCountry).then(function (result) {
      if (!result) return;
      CPGeo.setLocation({
        address: result.label || loc.address,
        postal_code: result.postal_code || loc.postal_code,
        city: result.city || loc.city,
        country: result.country || loc.country,
        country_code: result.country_code || loc.country_code,
        geocode_source: result.source,
        geocode_result_type: result.result_type,
        map_url: CPGeo.images.osmPermalink(lat, lon, cfg.map.defaultZoom),
        map_image_url: CPGeo.images.staticMapTileUrl(lat, lon, cfg.map.staticTileZoom),
        map_provider: 'OpenStreetMap'
      }, { log: { action: 'reverse_geocode' } });
    }).catch(function (e) {
      log('géocodage inverse en échec', e);
      CPGeo.setLocation({
        map_url: CPGeo.images.osmPermalink(lat, lon, cfg.map.defaultZoom),
        map_image_url: CPGeo.images.staticMapTileUrl(lat, lon, cfg.map.staticTileZoom),
        map_provider: 'OpenStreetMap'
      }, { silent: true });
    });
  }

  function onValidateLocation(refs) {
    var result = CPGeo.validateLocation();
    if (!result) {
      showMessage(refs.message, 'error',
        'Impossible de valider : recherchez d’abord l’adresse de votre entreprise.');
      return;
    }
    CPGeo.track('geo_location_validated', { geo_country: result.country_code });
    CPGeo.addHistory({ block: 'company_location', action: 'validated_by_user' });
    renderLocationBlock();
  }

  /* ============================ Modale A : recherche de localisation ============================ */
  function openLocationModal(opener) {
    var modal = new Modal({
      title: 'Rechercher la localisation de votre entreprise',
      subtitle: 'France métropolitaine prioritaire — recherche également possible en Europe.',
      opener: opener
    });

    var loc = CPGeo.getLocation();
    var prefill = readFormPrefill();

    var grid = el('div', 'cpgeo-field-grid');
    var fCompany = field({
      name: 'company', label: 'Nom de l’entreprise', full: true,
      placeholder: 'Ex. : Boulangerie Dupont', maxlength: 200,
      value: loc.company_name || prefill.company, autocomplete: 'organization'
    });
    var fStreet = field({
      name: 'street', label: 'Numéro et nom de rue', full: true,
      placeholder: 'Ex. : 12 rue de la Paix', maxlength: 200,
      value: [loc.house_number, loc.street].filter(Boolean).join(' '), autocomplete: 'street-address'
    });
    var fPostal = field({
      name: 'postal', label: 'Code postal', placeholder: 'Ex. : 75002', maxlength: 10,
      value: loc.postal_code || prefill.postal, inputmode: 'numeric', autocomplete: 'postal-code'
    });
    var fCity = field({
      name: 'city', label: 'Ville', placeholder: 'Ex. : Paris', maxlength: 120,
      value: loc.city, autocomplete: 'address-level2'
    });
    var fCountry = field({
      name: 'country', label: 'Pays', type: 'select',
      options: cfg.countries.map(function (c) {
        return {
          value: c.code, label: c.label,
          selected: c.code === (loc.country_code || cfg.defaultCountry)
        };
      })
    });
    [fCompany, fStreet, fPostal, fCity, fCountry].forEach(function (f) { grid.appendChild(f); });
    grid.appendChild(el('div', 'cpgeo-field cpgeo-full',
      '<span class="cpgeo-field-hint">Astuce : une adresse complète (rue + code postal + ville) donne les résultats les plus précis. Le nom d’entreprise fonctionne s’il est référencé dans OpenStreetMap.</span>'));
    modal.body.appendChild(grid);

    var message = el('div', 'cpgeo-message');
    modal.body.appendChild(message);

    var resultsWrap = el('div', 'cpgeo-results');
    resultsWrap.style.display = 'none';
    modal.body.appendChild(resultsWrap);

    var selected = null;          /* résultat sélectionné */
    var modalMap = null;          /* { map, marker } */
    var mapContainer = null;
    var confirmBtn = null;

    function cacheKey(input) {
      return JSON.stringify([input.companyName, input.street, input.postalCode, input.city, input.countryCode])
        .toLowerCase();
    }

    function runSearch() {
      var input = {
        companyName: fCompany._input.value,
        street: fStreet._input.value,
        postalCode: fPostal._input.value,
        city: fCity._input.value,
        countryCode: fCountry._input.value
      };
      /* Découpe "numéro + rue" */
      var m = utils.cleanText(input.street).match(/^(\d+[a-zA-Z]?(?:\s*(?:bis|ter|quater))?)\s+(.+)$/i);
      if (m) { input.houseNumber = m[1]; input.street = m[2]; }

      var key = cacheKey(input);
      hideMessage(message);
      modal.setBusy(true);
      CPGeo.setLocation({ status: STATUS.SEARCHING }, { silent: true });
      renderLocationBlock();

      var promise = ui.lastSearchCache[key]
        ? Promise.resolve(ui.lastSearchCache[key])
        : CPGeo.geocoding.search(input);

      promise.then(function (results) {
        modal.setBusy(false);
        var fresh = CPGeo.getLocation();
        CPGeo.setLocation({ status: fresh.status === STATUS.SEARCHING ? (fresh.address ? STATUS.FOUND : STATUS.EMPTY) : fresh.status }, { silent: true });
        if (!results.length) {
          showMessage(message, 'warning',
            'Aucune adresse trouvée pour cette recherche. Vérifiez la rue, le code postal et la ville, ou simplifiez la recherche (ex. : « 12 rue de la Paix Paris »).');
          resultsWrap.style.display = 'none';
          CPGeo.addHistory({ block: 'company_location', action: 'search_no_result', query: key.slice(0, 200) });
          renderLocationBlock();
          return;
        }
        ui.lastSearchCache[key] = results;
        CPGeo.addHistory({ block: 'company_location', action: 'search', results: results.length, query: key.slice(0, 200) });
        renderResults(results);
        renderLocationBlock();
      }).catch(function (error) {
        modal.setBusy(false);
        CPGeo.setLocation({ status: STATUS.ERROR, last_error: error.message || 'Erreur de recherche.' },
          { log: { action: 'search_error', code: error.code } });
        showMessage(message, 'error', error.message || 'Erreur de recherche. Réessayez dans un instant.');
        resultsWrap.style.display = 'none';
        renderLocationBlock();
      });
    }

    function renderResults(results) {
      resultsWrap.innerHTML = '';
      resultsWrap.style.display = 'block';
      resultsWrap.appendChild(el('div', 'cpgeo-results-title',
        results.length + ' résultat' + (results.length > 1 ? 's' : '') + ' — sélectionnez l’adresse de votre entreprise'));

      var list = el('ul', 'cpgeo-result-list');
      results.forEach(function (result, index) {
        var li = el('li', 'cpgeo-result-item');
        var btn = el('button', 'cpgeo-result-btn');
        btn.type = 'button';
        var typeLabel = RESULT_TYPE_LABELS[String(result.result_type || '').toLowerCase()] || result.result_type || '';
        btn.innerHTML =
          '<span class="cpgeo-result-marker"></span>' +
          '<span class="cpgeo-result-text">' + utils.escapeHtml(result.label) +
          '<span class="cpgeo-result-source">' + utils.escapeHtml(result.source) +
          (typeLabel ? ' <span class="cpgeo-result-type">' + utils.escapeHtml(typeLabel) + '</span>' : '') +
          '</span></span>';
        btn.addEventListener('click', function () {
          Array.prototype.forEach.call(list.children, function (c) { c.classList.remove('cpgeo-selected'); });
          li.classList.add('cpgeo-selected');
          selected = result;
          showResultOnMap(result);
          if (confirmBtn) confirmBtn.disabled = false;
        });
        li.appendChild(btn);
        list.appendChild(li);
        if (index === 0) {
          /* présélection du premier résultat (le plus pertinent) */
          li.classList.add('cpgeo-selected');
          selected = result;
        }
      });
      resultsWrap.appendChild(list);

      mapContainer = el('div', 'cpgeo-map cpgeo-map-modal');
      resultsWrap.appendChild(mapContainer);
      resultsWrap.appendChild(el('div', 'cpgeo-map-hint',
        'Vous pouvez déplacer le marqueur pour ajuster la position ; l’adresse est mise à jour automatiquement.'));

      createMap(mapContainer, { scrollWheelZoom: true }).then(function (map) {
        modalMap = {
          map: map,
          marker: window.L.marker([selected.latitude, selected.longitude], { draggable: true }).addTo(map)
        };
        modalMap.marker.on('dragend', function () {
          var pos = modalMap.marker.getLatLng();
          var lat = utils.roundCoord(pos.lat), lon = utils.roundCoord(pos.lng);
          selected = Object.assign({}, selected, { latitude: lat, longitude: lon, moved: true });
          CPGeo.geocoding.reverse(lat, lon, selected.country_code).then(function (rev) {
            if (!rev) return;
            selected = Object.assign({}, selected, {
              label: rev.label || selected.label,
              postal_code: rev.postal_code || selected.postal_code,
              city: rev.city || selected.city,
              country: rev.country || selected.country,
              country_code: rev.country_code || selected.country_code,
              source: rev.source
            });
            var sel = qs(resultsWrap, '.cpgeo-result-item.cpgeo-selected .cpgeo-result-text');
            if (sel) sel.childNodes[0].textContent = selected.label;
          }).catch(function () { /* la position modifiée reste utilisable */ });
        });
        map.setView([selected.latitude, selected.longitude], cfg.map.defaultZoom);
        window.setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 220);
      }).catch(function (e) {
        mapContainer.innerHTML = '';
        mapContainer.appendChild(el('div', 'cpgeo-map-placeholder', 'Carte indisponible — la sélection reste possible.'));
        log('carte modale indisponible', e);
      });

      if (selected && confirmBtn) confirmBtn.disabled = false;
    }

    function showResultOnMap(result) {
      if (!modalMap) return;
      modalMap.marker.setLatLng([result.latitude, result.longitude]);
      modalMap.map.setView([result.latitude, result.longitude], cfg.map.defaultZoom);
    }

    var searchBtn = modal.addButton('Lancer la recherche', 'cpgeo-btn-primary', runSearch);
    confirmBtn = modal.addButton('Utiliser cette localisation', 'cpgeo-btn-success', function () {
      if (!selected) return;
      applyLocationResult(selected, fCompany._input.value);
      modal.close();
    });
    confirmBtn.disabled = true;
    modal.addButton('Annuler', 'cpgeo-btn-ghost', function () { modal.close(); });

    modal.open();
    /* Entrée = lancer la recherche depuis n'importe quel champ */
    modal.overlay.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.keyCode === 13) && e.target && e.target.tagName === 'INPUT') {
        e.preventDefault();
        runSearch();
      }
    });
    window.setTimeout(function () { searchBtn.focus(); }, 80);
  }

  function applyLocationResult(result, companyName) {
    var lat = utils.roundCoord(result.latitude);
    var lon = utils.roundCoord(result.longitude);
    CPGeo.setLocation({
      status: STATUS.FOUND,
      search_id: utils.uuid(),
      company_name: utils.cleanText(companyName, 200),
      address: result.label,
      house_number: result.house_number || '',
      street: result.street || '',
      postal_code: result.postal_code || '',
      city: result.city || '',
      country: result.country || utils.countryLabel(result.country_code),
      country_code: result.country_code || cfg.defaultCountry,
      latitude: lat,
      longitude: lon,
      map_url: CPGeo.images.osmPermalink(lat, lon, cfg.map.defaultZoom),
      map_image_url: CPGeo.images.staticMapTileUrl(lat, lon, cfg.map.staticTileZoom),
      map_provider: 'OpenStreetMap',
      geocode_source: result.source,
      geocode_result_type: result.result_type,
      searched_at: utils.nowIso(),
      validated: false,
      validated_at: '',
      last_error: ''
    }, { log: { action: 'apply_result', source: result.source } });
    CPGeo.track('geo_location_selected', { geo_source: result.source });
    renderLocationBlock();
  }

  /* ============================ Bloc B : bâtiment ============================ */
  function buildBuildingBlock(container) {
    var refs = {};
    var block = el('section', 'cpgeo-block');
    block.setAttribute('data-cpgeo-block-ui', 'building');

    var head = el('div', 'cpgeo-block-head');
    var title = el('div', 'cpgeo-block-title', ICONS.building + ' <span>Bâtiment de l’entreprise</span>');
    refs.badge = el('span', 'cpgeo-badge cpgeo-badge-empty', BADGE_LABELS[STATUS.EMPTY]);
    refs.badge.setAttribute('aria-live', 'polite'); /* accessibilité */
    head.appendChild(title);
    head.appendChild(refs.badge);
    block.appendChild(head);
    block.appendChild(el('div', 'cpgeo-block-sub',
      'Retrouvez la photographie réelle de votre bâtiment (vue extérieure et vue aérienne). Aucune image générique n’est utilisée : chaque photo affiche sa source, sa licence et sa distance à votre adresse.'));

    refs.photoFrame = el('div', 'cpgeo-photo-frame');
    refs.photoFrame.style.display = 'none';
    block.appendChild(refs.photoFrame);

    refs.aerialRow = el('div', 'cpgeo-aerial-row');
    refs.aerialRow.style.display = 'none';
    block.appendChild(refs.aerialRow);

    refs.info = el('div', 'cpgeo-info');
    block.appendChild(refs.info);

    refs.message = el('div', 'cpgeo-message');
    block.appendChild(refs.message);

    var actions = el('div', 'cpgeo-actions');
    refs.validateBtn = el('button', 'cpgeo-btn cpgeo-btn-primary', ICONS.check + ' <span>Valider</span>');
    refs.validateBtn.type = 'button';
    refs.searchBtn = el('button', 'cpgeo-btn cpgeo-btn-secondary', ICONS.search + ' <span>Rechercher</span>');
    refs.searchBtn.type = 'button';
    actions.appendChild(refs.validateBtn);
    actions.appendChild(refs.searchBtn);
    block.appendChild(actions);

    refs.block = block;
    refs.validateBtn.addEventListener('click', function () { onValidateBuilding(refs); });
    refs.searchBtn.addEventListener('click', function () { openBuildingModal(refs.searchBtn); });

    container.appendChild(block);
    return refs;
  }

  function renderBuildingBlock() {
    var refs = ui.blocks.building;
    if (!refs) return;
    var b = CPGeo.getBuilding();

    refs.badge.className = 'cpgeo-badge ' + (BADGE_CLASSES[b.status] || 'cpgeo-badge-empty');
    refs.badge.textContent = b.status === STATUS.VALIDATED && b.validated_at
      ? 'Bâtiment validé le ' + formatDate(b.validated_at)
      : (BADGE_LABELS[b.status] || b.status);
    refs.block.classList.toggle('cpgeo-validated', !!b.validated);

    /* Photo principale */
    if (b.building_image_url) {
      refs.photoFrame.style.display = 'block';
      refs.photoFrame.innerHTML = '';
      var img = el('img');
      img.src = b.building_image_thumb_url || b.building_image_url;
      img.alt = 'Photographie du bâtiment — ' + (b.address || 'entreprise');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer-when-downgrade';
      img.addEventListener('error', function () {
        refs.photoFrame.innerHTML = '';
        refs.photoFrame.appendChild(el('div', 'cpgeo-map-placeholder',
          'L’image n’a pas pu être affichée (réseau). Sa référence reste enregistrée.'));
      });
      refs.photoFrame.appendChild(img);
      refs.photoFrame.appendChild(el('span', 'cpgeo-photo-type',
        utils.escapeHtml(IMAGE_TYPE_LABELS[b.image_type] || b.image_type || 'Image')));
      var captionBits = [];
      captionBits.push('Source : <strong>' + utils.escapeHtml(b.image_source || '—') + '</strong>');
      if (b.image_author) captionBits.push('Auteur : ' + utils.escapeHtml(b.image_author));
      if (b.image_license) captionBits.push('Licence : ' + utils.escapeHtml(b.image_license));
      if (b.image_distance_m != null) captionBits.push('Distance à l’adresse : ' + b.image_distance_m + ' m');
      if (b.image_page_url) {
        captionBits.push('<a href="' + utils.escapeHtml(b.image_page_url) +
          '" target="_blank" rel="noopener noreferrer">Page du fichier</a>');
      }
      refs.photoFrame.appendChild(el('div', 'cpgeo-photo-caption', captionBits.join(' · ')));
    } else {
      refs.photoFrame.style.display = 'none';
      refs.photoFrame.innerHTML = '';
    }

    /* Vue aérienne */
    if (b.aerial_image_url) {
      refs.aerialRow.style.display = 'flex';
      refs.aerialRow.innerHTML = '';
      var thumb = el('img', 'cpgeo-aerial-thumb');
      thumb.src = b.aerial_image_url;
      thumb.alt = 'Vue aérienne de l’emplacement';
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      refs.aerialRow.appendChild(thumb);
      refs.aerialRow.appendChild(el('div', 'cpgeo-aerial-meta',
        'Vue aérienne / satellite<br>Source : ' + utils.escapeHtml(b.aerial_provider || '—') +
        '<br>Position exacte (WGS84)'));
    } else {
      refs.aerialRow.style.display = 'none';
      refs.aerialRow.innerHTML = '';
    }

    /* Informations */
    refs.info.innerHTML = '';
    if (!b.address && b.latitude == null) {
      refs.info.appendChild(el('div', 'cpgeo-empty-note cpgeo-full',
        'Aucun bâtiment enregistré pour le moment. Cliquez sur « Rechercher ».'));
    } else {
      refs.info.appendChild(infoRow('Adresse', b.address || '—', { full: true }));
      refs.info.appendChild(infoRow('Code postal', b.postal_code || '—'));
      refs.info.appendChild(infoRow('Ville', b.city || '—'));
      refs.info.appendChild(infoRow('Pays', b.country || '—'));
      refs.info.appendChild(infoRow('Latitude', formatCoord(b.latitude), { mono: true }));
      refs.info.appendChild(infoRow('Longitude', formatCoord(b.longitude), { mono: true }));
      if (b.image_source) refs.info.appendChild(infoRow('Source image', b.image_source));
      if (b.image_type) refs.info.appendChild(infoRow('Type', IMAGE_TYPE_LABELS[b.image_type] || b.image_type));
    }

    var canValidate = b.latitude != null && b.longitude != null && !!b.building_image_url;
    refs.validateBtn.disabled = !canValidate;
    var labelSpan = qs(refs.validateBtn, 'span');
    if (labelSpan) labelSpan.textContent = b.validated ? 'Valider à nouveau' : 'Valider';

    if (b.status === STATUS.ERROR && b.last_error) showMessage(refs.message, 'error', b.last_error);
    else if (b.validated) showMessage(refs.message, 'success',
      'Bâtiment validé' + (b.validated_at ? ' le ' + formatDate(b.validated_at) : '') + '. La photographie et ses coordonnées sont associées à votre demande.');
    else if (b.status === STATUS.IMAGE_UNAVAILABLE) showMessage(refs.message, 'warning',
      b.no_image_reason || 'Aucune photographie fiable disponible pour cette adresse. Vous pouvez continuer : ce bloc est facultatif.');
    else if (b.status === STATUS.PENDING) showMessage(refs.message, 'info',
      'Image sélectionnée. Vérifiez qu’il s’agit bien de votre bâtiment puis cliquez sur « Valider ».');
    else hideMessage(refs.message);
  }

  function onValidateBuilding(refs) {
    var result = CPGeo.validateBuilding();
    if (!result) {
      showMessage(refs.message, 'error',
        'Impossible de valider : recherchez d’abord la photographie de votre bâtiment.');
      return;
    }
    CPGeo.track('geo_building_validated', { geo_image_source: result.image_source });
    renderBuildingBlock();
  }

  /* ============================ Modale B : recherche du bâtiment ============================ */
  function openBuildingModal(opener) {
    var modal = new Modal({
      title: 'Rechercher le bâtiment de votre entreprise',
      subtitle: 'Photographies extérieures géolocalisées (Wikimedia Commons) et vue aérienne — sans clé API, avec attribution.',
      opener: opener
    });

    var b = CPGeo.getBuilding();
    var loc = CPGeo.getLocation();
    var prefill = readFormPrefill();

    var grid = el('div', 'cpgeo-field-grid');
    var fCompany = field({
      name: 'company', label: 'Nom de l’entreprise', full: true,
      placeholder: 'Ex. : Boulangerie Dupont', maxlength: 200,
      value: loc.company_name || prefill.company, autocomplete: 'organization'
    });
    var fStreet = field({
      name: 'street', label: 'Numéro et nom de rue', full: true,
      placeholder: 'Ex. : 12 rue de la Paix', maxlength: 200,
      value: [loc.house_number, loc.street].filter(Boolean).join(' '),
      autocomplete: 'street-address'
    });
    var fPostal = field({
      name: 'postal', label: 'Code postal', placeholder: 'Ex. : 75002', maxlength: 10,
      value: loc.postal_code || b.postal_code || prefill.postal, inputmode: 'numeric', autocomplete: 'postal-code'
    });
    var fCity = field({ name: 'city', label: 'Ville', placeholder: 'Ex. : Paris', maxlength: 120, value: loc.city || b.city, autocomplete: 'address-level2' });
    var fCountry = field({
      name: 'country', label: 'Pays', type: 'select',
      options: cfg.countries.map(function (c) {
        return {
          value: c.code, label: c.label,
          selected: c.code === (loc.country_code || b.country_code || cfg.defaultCountry)
        };
      })
    });
    [fCompany, fStreet, fPostal, fCity, fCountry].forEach(function (f) { grid.appendChild(f); });
    grid.appendChild(el('div', 'cpgeo-field cpgeo-full',
      '<span class="cpgeo-field-hint">Les champs sont préremplis à partir du bloc « Localisation » — vous pouvez les modifier librement. Les deux blocs restent indépendants.</span>'));
    modal.body.appendChild(grid);

    var message = el('div', 'cpgeo-message');
    modal.body.appendChild(message);

    var resultsWrap = el('div', 'cpgeo-results');
    resultsWrap.style.display = 'none';
    modal.body.appendChild(resultsWrap);

    var selectedItem = null;
    var resolvedPoint = null;   /* adresse géocodée utilisée pour la recherche d'images */
    var aerialItem = null;
    var confirmBtn = null;

    function runSearch() {
      var input = {
        companyName: fCompany._input.value,
        street: fStreet._input.value,
        postalCode: fPostal._input.value,
        city: fCity._input.value,
        countryCode: fCountry._input.value
      };
      var m = utils.cleanText(input.street).match(/^(\d+[a-zA-Z]?(?:\s*(?:bis|ter|quater))?)\s+(.+)$/i);
      if (m) { input.houseNumber = m[1]; input.street = m[2]; }

      hideMessage(message);
      modal.setBusy(true);
      resultsWrap.style.display = 'none';
      resultsWrap.innerHTML = '';
      CPGeo.setBuilding({ status: STATUS.SEARCHING }, { silent: true });
      renderBuildingBlock();

      /* 1) résoudre l'adresse (réutilise la localisation validée si identique) */
      resolveAddressPoint(input, loc).then(function (point) {
        resolvedPoint = point;
        /* 2) rechercher les images auprès des fournisseurs autorisés */
        return CPGeo.images.findBuildingImages({
          lat: point.latitude, lon: point.longitude,
          radiusM: cfg.images.photoSearchRadiusM
        });
      }).then(function (found) {
        modal.setBusy(false);
        aerialItem = found.aerial;
        CPGeo.addHistory({
          block: 'company_building', action: 'search',
          photos: found.photos.length, providers: (found.providers_used || []).join(','),
          errors: found.errors.length
        });
        /* Le statut du bloc B est calculé au sein de renderBuildingResults :
           conservation de la sélection/validation précédente si le point
           résolu est identique, remise à zéro si l'adresse a changé. */
        renderBuildingResults(found);
      }).catch(function (error) {
        modal.setBusy(false);
        var msg = error && error.message ? error.message : 'Erreur pendant la recherche du bâtiment.';
        CPGeo.setBuilding({ status: STATUS.ERROR, last_error: msg },
          { log: { action: 'search_error', code: error && error.code } });
        showMessage(message, 'error', msg);
        renderBuildingBlock();
      });
    }

    function resolveAddressPoint(input, locationState) {
      /* Si la localisation validée correspond aux champs saisis, on reuse
         ses coordonnées (économie d'appels API, anti-doublons). */
      var samePostal = utils.cleanText(input.postalCode) === utils.cleanText(locationState.postal_code || '');
      var sameCity = utils.stripAccents(utils.cleanText(input.city).toLowerCase()) ===
        utils.stripAccents(utils.cleanText(locationState.city || '').toLowerCase());
      if (locationState.latitude != null && (samePostal || sameCity) && !input.street &&
          (utils.countryCode(input.countryCode) || cfg.defaultCountry) === (locationState.country_code || cfg.defaultCountry)) {
        return Promise.resolve({
          latitude: locationState.latitude,
          longitude: locationState.longitude,
          address: locationState.address,
          postal_code: locationState.postal_code,
          city: locationState.city,
          country: locationState.country,
          country_code: locationState.country_code,
          source: 'localisation validée (bloc A)'
        });
      }
      return CPGeo.geocoding.search(input).then(function (results) {
        if (!results.length) {
          throw {
            code: 'address_not_found',
            message: 'Adresse introuvable pour le bâtiment. Vérifiez la rue, le code postal et la ville, ou validez d’abord une localisation dans le bloc A.'
          };
        }
        var first = results[0];
        return {
          latitude: first.latitude, longitude: first.longitude,
          address: first.label, postal_code: first.postal_code,
          city: first.city, country: first.country,
          country_code: first.country_code, source: first.source
        };
      });
    }

    function renderBuildingResults(found) {
      resultsWrap.innerHTML = '';
      resultsWrap.style.display = 'block';
      selectedItem = null;
      if (confirmBtn) confirmBtn.disabled = true;

      resultsWrap.appendChild(el('div', 'cpgeo-results-title',
        'Adresse résolue : ' + utils.escapeHtml(resolvedPoint.address || '') +
        ' (' + formatCoord(resolvedPoint.latitude) + ', ' + formatCoord(resolvedPoint.longitude) + ')'));

      var photos = found.photos || [];
      var currentB = CPGeo.getBuilding();
      /* Même point que la sélection précédente ? Une nouvelle recherche au
         même endroit ne doit pas détruire une image déjà choisie/validée ;
         une recherche à une AUTRE adresse doit en revanche repartir de zéro. */
      var samePoint = currentB.latitude === resolvedPoint.latitude &&
        currentB.longitude === resolvedPoint.longitude;
      if (!photos.length) {
        /* Règle métier : jamais d'image générique ou de voisin présentée
           comme le bâtiment exact → message explicite + repli satellite
           (la vue aérienne reste sélectionnable : position exacte). */
        var keepPrevious = !!currentB.building_image_url && samePoint;
        var noImg = el('div', 'cpgeo-no-image',
          '<strong>Aucune photographie fiable du bâtiment n’a été trouvée</strong> à proximité immédiate de cette adresse ' +
          '(fournisseurs consultés : ' + utils.escapeHtml((found.providers_used || []).join(', ')) + ').<br><br>' +
          'Nous préférons ne rien afficher plutôt que vous montrer une image générique ou celle d’un bâtiment voisin. ' +
          (keepPrevious
            ? 'Votre sélection précédente est conservée. '
            : '') +
          'Vous pouvez :<br>• sélectionner la <strong>vue aérienne</strong> ci-dessous' +
          (aerialItem ? ' (image satellite de la position exacte)' : ' si elle est disponible') + ' ;<br>' +
          '• corriger l’adresse puis relancer la recherche ;<br>• continuer le formulaire sans valider ce bloc (il est facultatif).');
        resultsWrap.appendChild(noImg);
        if (aerialItem) {
          var fallbackGallery = el('div', 'cpgeo-gallery');
          fallbackGallery.appendChild(photoCard(aerialItem));
          resultsWrap.appendChild(fallbackGallery);
        }
        var noImageUpdate = {
          address: resolvedPoint.address,
          postal_code: resolvedPoint.postal_code || '',
          city: resolvedPoint.city || '',
          country: resolvedPoint.country || '',
          country_code: resolvedPoint.country_code || '',
          latitude: resolvedPoint.latitude,
          longitude: resolvedPoint.longitude,
          searched_at: found.searched_at,
          aerial_image_url: aerialItem ? aerialItem.url : (currentB.aerial_image_url || ''),
          aerial_provider: aerialItem ? aerialItem.source : (currentB.aerial_provider || ''),
          last_error: ''
        };
        if (keepPrevious) {
          /* sélection précédente conservée (même adresse) */
          noImageUpdate.status = currentB.validated ? STATUS.VALIDATED : STATUS.PENDING;
          noImageUpdate.no_image_reason = 'Aucune nouvelle photographie trouvée — sélection précédente conservée.';
        } else {
          /* aucune image fiable : état explicite, champs image nettoyés */
          noImageUpdate.status = STATUS.IMAGE_UNAVAILABLE;
          noImageUpdate.no_image_reason = 'Aucune photographie fiable trouvée dans un rayon de ' + cfg.images.photoSearchRadiusM + ' m.';
          noImageUpdate.building_image_url = '';
          noImageUpdate.building_image_thumb_url = '';
          noImageUpdate.image_source = '';
          noImageUpdate.image_type = '';
          noImageUpdate.image_license = '';
          noImageUpdate.image_author = '';
          noImageUpdate.image_page_url = '';
          noImageUpdate.image_distance_m = null;
          noImageUpdate.validated = false;
          noImageUpdate.validated_at = '';
        }
        CPGeo.setBuilding(noImageUpdate, { log: { action: 'no_image', keep_previous: keepPrevious } });
      } else {
        resultsWrap.appendChild(el('div', 'cpgeo-results-title',
          photos.length + ' photographie' + (photos.length > 1 ? 's' : '') +
          ' géolocalisée' + (photos.length > 1 ? 's' : '') + ' trouvée' + (photos.length > 1 ? 's' : '') +
          ' — sélectionnez celle qui correspond réellement à votre entreprise'));
        var gallery = el('div', 'cpgeo-gallery');
        photos.slice(0, 9).forEach(function (item) { gallery.appendChild(photoCard(item)); });
        if (aerialItem) gallery.appendChild(photoCard(aerialItem));
        resultsWrap.appendChild(gallery);
        resultsWrap.appendChild(el('div', 'cpgeo-map-hint',
          'Les distances indiquées sont calculées entre la position de chaque image et l’adresse recherchée. Au-delà de ' +
          cfg.images.photoMaxReliableDistanceM + ' m, vérifiez qu’il s’agit bien de votre bâtiment avant de valider.'));
        /* Mémoriser l'adresse résolue + vue aérienne dans l'état du bloc B,
           sans écraser une sélection précédente au même point. */
        var photoUpdate = {
          address: resolvedPoint.address,
          postal_code: resolvedPoint.postal_code || '',
          city: resolvedPoint.city || '',
          country: resolvedPoint.country || '',
          country_code: resolvedPoint.country_code || '',
          latitude: resolvedPoint.latitude,
          longitude: resolvedPoint.longitude,
          searched_at: found.searched_at,
          aerial_image_url: aerialItem ? aerialItem.url : (currentB.aerial_image_url || ''),
          aerial_provider: aerialItem ? aerialItem.source : (currentB.aerial_provider || ''),
          no_image_reason: '', last_error: ''
        };
        if (!samePoint && currentB.building_image_url) {
          /* nouvelle adresse : l'ancienne photo ne correspond plus */
          photoUpdate.status = STATUS.FOUND;
          photoUpdate.building_image_url = '';
          photoUpdate.building_image_thumb_url = '';
          photoUpdate.image_source = '';
          photoUpdate.image_type = '';
          photoUpdate.image_license = '';
          photoUpdate.image_author = '';
          photoUpdate.image_page_url = '';
          photoUpdate.image_distance_m = null;
          photoUpdate.validated = false;
          photoUpdate.validated_at = '';
        } else if (samePoint && currentB.building_image_url) {
          /* même adresse : la sélection/validation précédente est conservée */
          photoUpdate.status = currentB.validated ? STATUS.VALIDATED : STATUS.PENDING;
        } else {
          photoUpdate.status = STATUS.FOUND;
        }
        CPGeo.setBuilding(photoUpdate, { log: { action: 'results', count: photos.length } });
      }
      renderBuildingBlock();
    }

    function photoCard(item) {
      var card = el('div', 'cpgeo-photo-card');
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      var img = el('img');
      img.src = item.thumb_url || item.url;
      img.alt = item.title || 'Photographie candidate';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', function () {
        img.alt = 'Image non chargée (réseau) — sélection possible';
        img.style.background = '#dfe6ee';
      });
      card.appendChild(img);
      var body = el('div', 'cpgeo-photo-card-body');
      var tags = el('div', 'cpgeo-photo-card-tags');
      var typeClass = item.type === 'satellite' ? 'cpgeo-tag-sat' : (item.type === 'street_view' ? 'cpgeo-tag-street' : 'cpgeo-tag-photo');
      tags.appendChild(el('span', 'cpgeo-tag ' + typeClass,
        utils.escapeHtml(IMAGE_TYPE_LABELS[item.type] || item.type)));
      var far = item.distance_m != null && item.distance_m > cfg.images.photoMaxReliableDistanceM;
      if (item.distance_m != null) {
        tags.appendChild(el('span', 'cpgeo-tag ' + (far ? 'cpgeo-tag-distance-far' : 'cpgeo-tag-distance'),
          item.distance_m + ' m'));
      }
      body.appendChild(tags);
      body.appendChild(el('div', 'cpgeo-photo-card-title', utils.escapeHtml(item.title || item.source)));
      body.appendChild(el('div', 'cpgeo-photo-card-meta',
        utils.escapeHtml(item.source) + (item.author ? ' · ' + utils.escapeHtml(item.author) : '') +
        (item.license ? ' · ' + utils.escapeHtml(item.license) : '')));
      if (far && item.type !== 'satellite') {
        body.appendChild(el('div', 'cpgeo-photo-card-warning',
          '⚠ À ' + item.distance_m + ' m de l’adresse : vérifiez qu’il s’agit bien de votre bâtiment.'));
      }
      card.appendChild(body);

      function select() {
        Array.prototype.forEach.call(card.parentNode.children, function (c) { c.classList.remove('cpgeo-selected'); });
        card.classList.add('cpgeo-selected');
        selectedItem = item;
        if (confirmBtn) confirmBtn.disabled = false;
      }
      card.addEventListener('click', select);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 32) { e.preventDefault(); select(); }
      });
      return card;
    }

    var searchBtn = modal.addButton('Lancer la recherche', 'cpgeo-btn-primary', runSearch);
    confirmBtn = modal.addButton('Utiliser cette image', 'cpgeo-btn-success', function () {
      if (!selectedItem || !resolvedPoint) return;
      applyBuildingItem(selectedItem, resolvedPoint);
      modal.close();
    });
    confirmBtn.disabled = true;
    modal.addButton('Annuler', 'cpgeo-btn-ghost', function () { modal.close(); });

    modal.open();
    modal.overlay.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.keyCode === 13) && e.target && e.target.tagName === 'INPUT') {
        e.preventDefault();
        runSearch();
      }
    });
    window.setTimeout(function () { searchBtn.focus(); }, 80);
  }

  function applyBuildingItem(item, point) {
    CPGeo.setBuilding({
      status: STATUS.PENDING,
      search_id: utils.uuid(),
      address: point.address,
      postal_code: point.postal_code || '',
      city: point.city || '',
      country: point.country || '',
      country_code: point.country_code || cfg.defaultCountry,
      latitude: point.latitude,
      longitude: point.longitude,
      building_image_url: item.url,
      building_image_thumb_url: item.thumb_url || item.url,
      image_source: item.source,
      image_type: item.type,
      image_license: item.license || '',
      image_author: item.author || '',
      image_page_url: item.page_url || '',
      image_distance_m: item.distance_m != null ? item.distance_m : null,
      aerial_image_url: item.type === 'satellite' ? item.url : (CPGeo.getBuilding().aerial_image_url || ''),
      aerial_provider: item.type === 'satellite' ? item.source : (CPGeo.getBuilding().aerial_provider || ''),
      searched_at: item.fetched_at || utils.nowIso(),
      validated: false,
      validated_at: '',
      no_image_reason: '',
      last_error: ''
    }, { log: { action: 'apply_image', source: item.source, type: item.type, distance_m: item.distance_m } });
    CPGeo.track('geo_building_image_selected', { geo_image_source: item.source, geo_image_type: item.type });
    renderBuildingBlock();
  }

  /* ============================ Préremplissage depuis le formulaire ============================ */
  function readFormPrefill() {
    var out = { company: '', postal: '' };
    try {
      var form = document.querySelector('form[data-ubepro-lead="1"]');
      if (!form) return out;
      var societe = form.querySelector('[name="societe"]');
      var cp = form.querySelector('[name="code_postal"]');
      if (societe) out.company = utils.cleanText(societe.value, 200);
      if (cp) out.postal = utils.cleanText(cp.value, 10).replace(/\s+/g, '');
    } catch (e) { /* noop */ }
    return out;
  }

  /* ============================ Montage ============================ */
  function mount() {
    if (ui.mounted) return;
    var root = document.getElementById('cpgeo-root');
    if (!root) return;
    ui.root = root;
    ui.stepEl = root.closest ? root.closest('[data-form="step"]') : null;

    ui.blocks.location = buildLocationBlock(root);
    ui.blocks.building = buildBuildingBlock(root);
    ui.mounted = true;

    /* Restaurer l'état persistant (rechargement / retour d'étape) */
    CPGeo.restore();
    renderLocationBlock();
    renderBuildingBlock();

    /* Observer la visibilité de l'étape : initialiser les cartes quand
       l'étape est réellement affichée (Formly masque les étapes en
       display:none, Leaflet a besoin d'un conteneur visible). */
    watchStepVisibility();

    CPGeo.on('statechange', function () {
      renderLocationBlock();
      renderBuildingBlock();
    });
  }

  function watchStepVisibility() {
    var stepEl = ui.stepEl || ui.root;
    if (!stepEl) return;
    function refreshVisibility() {
      var visible = !!(stepEl.getClientRects().length);
      if (visible && !ui.stepVisible) {
        ui.stepVisible = true;
        var loc = CPGeo.getLocation();
        if (loc.latitude != null) updateLocationMap(loc);
        /* rafraîchir le préremplissage au passage sur l'étape */
        var prefill = readFormPrefill();
        if (prefill.company && !CPGeo.getLocation().company_name) {
          CPGeo.setLocation({ company_name: prefill.company }, { silent: true });
        }
      } else if (!visible && ui.stepVisible) {
        ui.stepVisible = false;
      }
      if (visible && ui.locationMap) {
        window.setTimeout(function () { try { ui.locationMap.map.invalidateSize(); } catch (e) {} }, 120);
      }
    }
    if (typeof IntersectionObserver === 'function') {
      var observer = new IntersectionObserver(function () { refreshVisibility(); }, { threshold: 0.05 });
      observer.observe(stepEl);
    }
    /* Filet de sécurité : vérification périodique légère (2 s) */
    window.setInterval(refreshVisibility, 2000);
    refreshVisibility();
  }

  CPGeo.ui.mount = mount;
  CPGeo.ui.renderAll = function () { renderLocationBlock(); renderBuildingBlock(); };
  CPGeo.ui.Modal = Modal;
  CPGeo.ui.ensureLeaflet = ensureLeaflet;
  CPGeo.ui._readFormPrefill = readFormPrefill;
  /* Accroches QA/tests (ouverture programmatique des modales) */
  CPGeo.ui._openLocationModal = openLocationModal;
  CPGeo.ui._openBuildingModal = openBuildingModal;
})(window, document);
