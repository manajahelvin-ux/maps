/* =====================================================================
   cp-geo-geocoding.js — Recherche géographique France + Europe
   ---------------------------------------------------------------------
   Fournisseurs (sans clé API, appel direct navigateur) :
   - France : Base Adresse Nationale (api-adresse.data.gouv.fr) en
     priorité — adresses professionnelles, codes postaux 5 chiffres,
     communes, arrondissements, numéros et noms de voies ;
   - Europe / complément : Nominatim (OpenStreetMap), limité à
     1 requête/seconde conformément à sa politique d'usage, avec
     countrycodes pour lever les ambiguïtés de villes homonymes.
   - Recherche par nom d'entreprise : Nominatim interroge les POI OSM
     (entreprises/établissements cartographiés). Un nom absent d'OSM ne
     peut pas être deviné : l'utilisateur complète alors avec la rue.

   Toutes les coordonnées sont normalisées en WGS84 (lat/lon décimaux).
   ===================================================================== */
(function (window) {
  'use strict';

  var CPGeo = window.CPGeo = window.CPGeo || {};
  var cfg = CPGeo.config;
  var utils = CPGeo.utils;
  var log = CPGeo.log;

  /* ---------------- File d'attente Nominatim (1 req / 1,1 s) ---------------- */
  var nominatimQueue = Promise.resolve();
  var nominatimLast = 0;

  function nominatimFetch(url) {
    var run = nominatimQueue.then(function () {
      var wait = Math.max(0, cfg.nominatim.minIntervalMs - (Date.now() - nominatimLast));
      return new Promise(function (resolve) { window.setTimeout(resolve, wait); }).then(function () {
        nominatimLast = Date.now();
        return utils.fetchJson(url, {
          headers: { 'Accept': 'application/json', 'Accept-Language': 'fr' }
        });
      });
    });
    /* La file continue même si une requête échoue */
    nominatimQueue = run.catch(function () {});
    return run;
  }

  /* ---------------- Normalisation BAN (GeoJSON) ---------------- */
  function normalizeBanFeature(feature) {
    var p = feature.properties || {};
    var coords = (feature.geometry && feature.geometry.coordinates) || [];
    var lat = utils.roundCoord(coords[1]);
    var lon = utils.roundCoord(coords[0]);
    if (lat == null || lon == null) return null;
    var city = utils.cleanText(p.city || '', 120);
    var postcode = utils.cleanText(p.postcode || '', 10);
    var street = utils.cleanText(p.street || p.name || '', 200);
    var houseNumber = utils.cleanText(p.housenumber || '', 12);
    var address = utils.cleanText(p.label || '', 300);
    return {
      label: address,
      house_number: houseNumber,
      street: street,
      postal_code: postcode,
      city: city,
      /* BAN : context = département ; pas de champ pays => France */
      country: 'France',
      country_code: 'FR',
      latitude: utils.clampLat(lat),
      longitude: utils.clampLon(lon),
      source: 'BAN (Base Adresse Nationale)',
      result_type: utils.cleanText(p.type || '', 40),   /* housenumber|street|locality|municipality */
      score: typeof p.score === 'number' ? p.score : 0,
      context: utils.cleanText(p.context || '', 120)
    };
  }

  /* ---------------- Normalisation Nominatim (jsonv2) ---------------- */
  function nominatimCity(addr) {
    return utils.cleanText(
      addr.city || addr.town || addr.village || addr.municipality ||
      addr.hamlet || addr.city_district || addr.suburb || '', 120);
  }
  function normalizeNominatimItem(item) {
    var lat = utils.roundCoord(item.lat);
    var lon = utils.roundCoord(item.lon);
    if (lat == null || lon == null) return null;
    var addr = item.address || {};
    var countryCode = utils.cleanText(addr.country_code || '', 2).toUpperCase();
    return {
      label: utils.cleanText(item.display_name || '', 300),
      house_number: utils.cleanText(addr.house_number || '', 12),
      street: utils.cleanText(addr.road || addr.pedestrian || addr.street || '', 200),
      postal_code: utils.cleanText(addr.postcode || '', 12),
      city: nominatimCity(addr),
      country: utils.cleanText(addr.country || utils.countryLabel(countryCode) || '', 120),
      country_code: countryCode,
      latitude: utils.clampLat(lat),
      longitude: utils.clampLon(lon),
      source: 'Nominatim (OpenStreetMap)',
      result_type: utils.cleanText((item.addresstype || item.type || ''), 40),
      importance: typeof item.importance === 'number' ? item.importance : 0,
      osm_type: utils.cleanText(item.osm_type || '', 10),
      osm_id: item.osm_id != null ? String(item.osm_id) : ''
    };
  }

  /* ---------------- Construction des requêtes ---------------- */
  function buildQueryParts(input) {
    var houseNumber = utils.cleanText(input.houseNumber || '', 12);
    var street = utils.cleanText(input.street || '', 200);
    var postalCode = utils.cleanText(input.postalCode || '', 12).replace(/\s+/g, '');
    var city = utils.cleanText(input.city || '', 120);
    var streetLine = (houseNumber && street)
      ? houseNumber + ' ' + street
      : (street || '');
    return { houseNumber: houseNumber, street: street, streetLine: streetLine, postalCode: postalCode, city: city };
  }

  function banSearch(params) {
    var url = new URL(cfg.ban.searchUrl);
    url.searchParams.set('q', params.q);
    url.searchParams.set('limit', String(params.limit || 8));
    if (params.postcode) url.searchParams.set('postcode', params.postcode);
    if (params.type) url.searchParams.set('type', params.type);
    return utils.fetchJson(url.href, { headers: { 'Accept': 'application/json' } }).then(function (geojson) {
      var features = (geojson && geojson.features) || [];
      return features.map(normalizeBanFeature).filter(Boolean);
    });
  }

  function nominatimSearch(params) {
    var url = new URL(cfg.nominatim.searchUrl);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', String(params.limit || cfg.nominatim.limit));
    if (params.q) url.searchParams.set('q', params.q);
    if (params.countryCodes) url.searchParams.set('countrycodes', params.countryCodes.toLowerCase());
    /* Structured mode is not used: Nominatim forbids combining q with
       structured fields; free-text with country bias is more reliable. */
    return nominatimFetch(url.href).then(function (items) {
      return (Array.isArray(items) ? items : []).map(normalizeNominatimItem).filter(Boolean);
    });
  }

  function banReverse(lat, lon) {
    var url = new URL(cfg.ban.reverseUrl);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    return utils.fetchJson(url.href, { headers: { 'Accept': 'application/json' } }).then(function (geojson) {
      var features = (geojson && geojson.features) || [];
      var first = features.map(normalizeBanFeature).filter(Boolean)[0];
      return first || null;
    });
  }

  function nominatimReverse(lat, lon) {
    var url = new URL(cfg.nominatim.reverseUrl);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('zoom', '18');
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    return nominatimFetch(url.href).then(function (item) {
      return item && item.lat != null ? normalizeNominatimItem(item) : null;
    });
  }

  /* ---------------- Déduplication / tri ---------------- */
  function dedupe(results) {
    var seen = Object.create(null);
    var out = [];
    results.forEach(function (r) {
      var key = r.latitude.toFixed(4) + ',' + r.longitude.toFixed(4) + '|' +
        utils.stripAccents(r.label.toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen[key]) return;
      seen[key] = true;
      out.push(r);
    });
    return out;
  }

  function sortResults(results) {
    return results.slice().sort(function (a, b) {
      /* priorité aux résultats précis (numéro de rue) puis au score */
      var rankA = a.house_number ? 0 : (a.street ? 1 : 2);
      var rankB = b.house_number ? 0 : (b.street ? 1 : 2);
      if (rankA !== rankB) return rankA - rankB;
      var sa = a.score != null ? a.score : (a.importance != null ? a.importance : 0);
      var sb = b.score != null ? b.score : (b.importance != null ? b.importance : 0);
      return sb - sa;
    });
  }

  /* ---------------- Recherche principale ----------------
     input = { companyName, houseNumber, street, postalCode, city,
               countryCode }
     Résout : tableau de résultats normalisés (0..N).
     Rejette : { code:'network'|'timeout'|'http'|'empty_query', message }
     -------------------------------------------------------- */
  function search(input) {
    var parts = buildQueryParts(input || {});
    var countryCode = utils.countryCode(input && input.countryCode) || cfg.defaultCountry;
    var companyName = utils.cleanText(input && input.companyName, 200);

    var freeQuery = [parts.streetLine, parts.postalCode, parts.city].filter(Boolean).join(' ');
    if (!freeQuery && !companyName) {
      return Promise.reject({
        code: 'empty_query',
        message: 'Renseignez au moins une rue, ou un nom d’entreprise avec une ville.'
      });
    }

    var isFrance = countryCode === 'FR';
    var hasAddressFields = !!(parts.streetLine || parts.postalCode || parts.city);

    function normalizeError(e) {
      if (e && e.name === 'AbortError') return { code: 'timeout', message: 'Le service de géocodage met trop de temps à répondre. Réessayez.' };
      if (e && e.httpStatus) return { code: 'http', message: 'Service de géocodage indisponible (HTTP ' + e.httpStatus + '). Réessayez.' };
      if (e && e.code) return e;
      return { code: 'network', message: 'Connexion au service de géocodage impossible. Vérifiez votre réseau.' };
    }

    /* ---- France ---- */
    if (isFrance) {
      var banPostcode = /^\d{5}$/.test(parts.postalCode) ? parts.postalCode : '';

      /* Cas 1 : nom d'entreprise sans rue → chercher d'abord l'entreprise
         dans les POI OpenStreetMap (Nominatim), puis repli BAN sur la
         ville/le code postal pour permettre au moins un réglage carte. */
      if (companyName && !parts.streetLine) {
        var poiQuery = [companyName, parts.city || parts.postalCode].filter(Boolean).join(', ');
        return nominatimSearch({ q: poiQuery, countryCodes: 'fr', limit: 8 })
          .then(function (osmResults) {
            if (osmResults.length) return sortResults(dedupe(osmResults));
            if (!hasAddressFields) return osmResults;
            return banSearch({ q: freeQuery, postcode: banPostcode, limit: 8 })
              .then(function (banResults) { return sortResults(dedupe(banResults)); })
              .catch(function () { return []; });
          })
          .catch(function (osmError) {
            /* Nominatim injoignable : tenter la BAN sur la ville/CP */
            if (!hasAddressFields) throw normalizeError(osmError);
            return banSearch({ q: freeQuery, postcode: banPostcode, limit: 8 })
              .then(function (banResults) { return sortResults(dedupe(banResults)); })
              .catch(function (banError) { throw normalizeError(banError); });
          });
      }

      /* Cas 2 : champs d'adresse (rue et/ou CP et/ou ville) → BAN d'abord,
         complément Nominatim si peu de résultats, repli Nominatim si la
         BAN est injoignable. */
      if (hasAddressFields) {
        return banSearch({ q: freeQuery, postcode: banPostcode, limit: 8 })
          .then(function (banResults) {
            if (banResults.length >= 3) return sortResults(dedupe(banResults));
            return nominatimSearch({ q: freeQuery, countryCodes: 'fr', limit: 8 })
              .then(function (osmResults) {
                return sortResults(dedupe(banResults.concat(osmResults)));
              })
              .catch(function () { return sortResults(dedupe(banResults)); });
          })
          .catch(function (banError) {
            log('BAN en échec, repli Nominatim', banError);
            return nominatimSearch({ q: freeQuery, countryCodes: 'fr', limit: 8 })
              .then(function (osmResults) {
                if (!osmResults.length) throw normalizeError(banError);
                return sortResults(dedupe(osmResults));
              })
              .catch(function (osmError) { throw normalizeError(osmError && osmError.code ? osmError : banError); });
          });
      }
    }

    /* ---- Europe (hors France) ou France sans aucun champ ---- */
    var query = freeQuery || companyName;
    if (freeQuery && companyName) query = [companyName, freeQuery].join(', ');
    return nominatimSearch({ q: query, countryCodes: countryCode.toLowerCase(), limit: 8 })
      .then(function (results) { return sortResults(dedupe(results)); })
      .catch(function (e) { throw normalizeError(e); });
  }

  /* ---------------- Géocodage inverse (marqueur déplacé) ---------------- */
  function reverse(lat, lon, countryCode) {
    lat = utils.roundCoord(lat);
    lon = utils.roundCoord(lon);
    if (lat == null || lon == null) {
      return Promise.reject({ code: 'invalid_coords', message: 'Coordonnées invalides.' });
    }
    var isFrance = (utils.countryCode(countryCode) || cfg.defaultCountry) === 'FR';
    if (isFrance && cfg.ban.enabled) {
      return banReverse(lat, lon).then(function (r) {
        if (r) {
          r.latitude = lat; r.longitude = lon;   /* conserver le point exact du marqueur */
          return r;
        }
        return nominatimReverse(lat, lon).then(function (r2) {
          if (r2) { r2.latitude = lat; r2.longitude = lon; }
          return r2;
        });
      }).catch(function () {
        return nominatimReverse(lat, lon).then(function (r2) {
          if (r2) { r2.latitude = lat; r2.longitude = lon; }
          return r2;
        });
      });
    }
    return nominatimReverse(lat, lon).then(function (r) {
      if (r) { r.latitude = lat; r.longitude = lon; }
      return r;
    });
  }

  CPGeo.geocoding = {
    search: search,
    reverse: reverse,
    /* exposés pour tests et fournisseurs d'images */
    _normalizeBanFeature: normalizeBanFeature,
    _normalizeNominatimItem: normalizeNominatimItem,
    _dedupe: dedupe,
    _sortResults: sortResults
  };
})(window);
