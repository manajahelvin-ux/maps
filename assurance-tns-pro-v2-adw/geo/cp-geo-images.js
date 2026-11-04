/* =====================================================================
   cp-geo-images.js — Gestion des images de bâtiments (multi-fournisseurs)
   ---------------------------------------------------------------------
   Architecture en fournisseurs branchables. Par défaut (sans clé API) :
   - "wikimedia-commons" : photographies géolocalisées Wikimedia Commons
     (photos extérieures réelles, licence + auteur + page affichés) ;
   - "esri-aerial" : tuile satellite Esri World Imagery à la position
     exacte (vue aérienne), avec attribution.
   Facultatifs (proxy serveur requis, JAMAIS de clé dans le JS public) :
   - "street-view-proxy" : Google Street View via votre proxy ;
   - "mapillary-proxy" : Mapillary via votre proxy.

   Règle métier : une photo n'est jamais présentée comme étant "le
   bâtiment exact" sans vérification — chaque résultat porte sa
   distance au point recherché ; l'UI avertit au-delà du seuil et
   l'utilisateur confirme explicitement. Si aucune photo fiable n'est
   trouvée, un message explicite est affiché (statut image_unavailable)
   et la vue satellite reste disponible en repli.

   Pas de scraping : uniquement des API officielles avec attribution,
   licences affichées, et contrôle des URL renvoyées (liste d'hôtes).
   ===================================================================== */
(function (window) {
  'use strict';

  var CPGeo = window.CPGeo = window.CPGeo || {};
  var cfg = CPGeo.config;
  var utils = CPGeo.utils;
  var log = CPGeo.log;

  /* ---------------- Géométrie Web Mercator (tuiles) ---------------- */
  function lonToTileX(lon, zoom) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
  }
  function latToTileY(lat, zoom) {
    var rad = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, zoom));
  }

  function fillTemplate(tpl, z, x, y) {
    return String(tpl).replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  /* Tuile OSM = aperçu cartographique enregistré pour le bloc A */
  function staticMapTileUrl(lat, lon, zoom) {
    var z = zoom || cfg.map.staticTileZoom;
    return fillTemplate(cfg.map.osmTileUrl, z,
      lonToTileX(utils.clampLon(lon), z), latToTileY(utils.clampLat(lat), z));
  }
  /* Tuile satellite Esri = vue aérienne à la position exacte */
  function aerialImageUrl(lat, lon, zoom) {
    var z = zoom || 18;
    return fillTemplate(cfg.map.esriImageryTileUrl, z,
      lonToTileX(utils.clampLon(lon), z), latToTileY(utils.clampLat(lat), z));
  }
  /* Permalink OpenStreetMap avec marqueur = référence de carte */
  function osmPermalink(lat, lon, zoom) {
    var z = zoom || cfg.map.defaultZoom;
    return 'https://www.openstreetmap.org/?mlat=' + utils.clampLat(lat).toFixed(6) +
      '&mlon=' + utils.clampLon(lon).toFixed(6) + '#map=' + z + '/' +
      utils.clampLat(lat).toFixed(5) + '/' + utils.clampLon(lon).toFixed(5);
  }

  function stripHtml(value, limit) {
    return utils.cleanText(String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"'), limit || 200);
  }

  /* ---------------- Fournisseur : Wikimedia Commons ---------------- */
  var EXCLUDED_TITLE_RE = /(carte|map\b|logo|plan\b|drapeau|flag|blason|coat of arms|armoiries|diagram|graph|chart|schema|schéma|panneau|signal|screenshot|capture|bandeau|icon|pictogram)/i;

  function commonsFindImages(params) {
    var url = new URL(cfg.images.commonsApiUrl);
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'geosearch');
    url.searchParams.set('ggscoord', params.lat + '|' + params.lon);
    url.searchParams.set('ggsradius', String(Math.min(10000, Math.max(50, params.radiusM || cfg.images.photoSearchRadiusM))));
    url.searchParams.set('ggslimit', '20');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|size|mime|extmetadata');
    url.searchParams.set('iiurlwidth', String(cfg.images.thumbWidth || 720));
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');           /* CORS anonyme */
    url.searchParams.set('uselang', 'fr');

    return utils.fetchJson(url.href, { headers: { 'Accept': 'application/json' } }).then(function (data) {
      var pages = (data && data.query && data.query.pages) || {};
      var items = [];
      Object.keys(pages).forEach(function (key) {
        var page = pages[key] || {};
        var info = (page.imageinfo && page.imageinfo[0]) || null;
        if (!info) return;
        var mime = String(info.mime || '');
        if (mime !== 'image/jpeg' && mime !== 'image/png') return;
        if ((info.width || 0) < 320 || (info.height || 0) < 240) return;
        var title = String(page.title || '');
        if (EXCLUDED_TITLE_RE.test(title)) return;
        var fullUrl = String(info.url || '');
        var thumbUrl = String(info.thumburl || fullUrl);
        if (!utils.isAllowedUrl(fullUrl) || !utils.isAllowedUrl(thumbUrl)) return;

        var coord = (page.coordinates && page.coordinates[0]) || {};
        var imgLat = utils.roundCoord(coord.lat != null ? coord.lat : params.lat);
        var imgLon = utils.roundCoord(coord.lon != null ? coord.lon : params.lon);
        var dist = coord.dist != null
          ? Math.round(coord.dist)
          : utils.distanceM(params.lat, params.lon, imgLat, imgLon);

        var meta = info.extmetadata || {};
        function metaValue(name) { return meta[name] ? stripHtml(meta[name].value, 200) : ''; }

        items.push({
          url: fullUrl,
          thumb_url: thumbUrl,
          source: 'Wikimedia Commons',
          type: 'photo_exterieure',
          title: utils.cleanText(title.replace(/^File:/i, ''), 200),
          page_url: 'https://commons.wikimedia.org/wiki/' + encodeURI(title.replace(/ /g, '_')),
          license: metaValue('LicenseShortName') || 'Voir la page du fichier',
          author: metaValue('Artist') || 'Inconnu',
          credit: metaValue('Credit'),
          description: metaValue('ImageDescription').slice(0, 220),
          latitude: imgLat,
          longitude: imgLon,
          distance_m: dist,
          width: info.width || null,
          height: info.height || null,
          fetched_at: utils.nowIso()
        });
      });
      items.sort(function (a, b) { return a.distance_m - b.distance_m; });
      return { provider: 'wikimedia-commons', items: items };
    });
  }

  /* ---------------- Fournisseur : vue aérienne Esri ---------------- */
  function esriAerialFindImages(params) {
    var item = {
      url: aerialImageUrl(params.lat, params.lon, 18),
      thumb_url: aerialImageUrl(params.lat, params.lon, 17),
      source: 'Esri World Imagery',
      type: 'satellite',
      title: 'Vue aérienne — position exacte',
      page_url: '',
      license: 'Usage avec attribution (voir GEO-MODULE.md)',
      author: 'Esri, Maxar, Earthstar Geographics et la communauté GIS',
      credit: 'Esri World Imagery',
      description: 'Imagerie satellite centrée sur les coordonnées de l’entreprise.',
      latitude: utils.roundCoord(params.lat),
      longitude: utils.roundCoord(params.lon),
      distance_m: 0,
      width: 256, height: 256,
      fetched_at: utils.nowIso()
    };
    return Promise.resolve({ provider: 'esri-aerial', items: utils.isAllowedUrl(item.url) ? [item] : [] });
  }

  /* ------------- Fournisseur facultatif : Street View (proxy) -------------
     Le proxy serveur détient la clé API Google et renvoie :
     { "image_url": "...", "heading": 123, "lat": .., "lon": ..,
       "date": "...", "status": "OK" }
     ------------------------------------------------------------------------ */
  function streetViewProxyFindImages(params) {
    if (!cfg.images.streetViewProxy) return Promise.resolve({ provider: 'street-view-proxy', items: [] });
    var url = new URL(cfg.images.streetViewProxy, window.location.href);
    url.searchParams.set('lat', String(params.lat));
    url.searchParams.set('lon', String(params.lon));
    url.searchParams.set('radius', String(params.radiusM || 60));
    return utils.fetchJson(url.href, { headers: { 'Accept': 'application/json' } }).then(function (data) {
      if (!data || data.status !== 'OK' || !data.image_url) return { provider: 'street-view-proxy', items: [] };
      if (!utils.isAllowedUrl(data.image_url, ['maps.google.com', 'lh3.googleusercontent.com', 'streetviewpixels-pa.googleapis.com'])) {
        return { provider: 'street-view-proxy', items: [] };
      }
      return {
        provider: 'street-view-proxy',
        items: [{
          url: data.image_url, thumb_url: data.image_url,
          source: 'Google Street View (proxy)', type: 'street_view',
          title: 'Vue de rue', page_url: '',
          license: 'Google Maps Platform — licences commerciales à vérifier côté proxy',
          author: 'Google', credit: '', description: '',
          latitude: utils.roundCoord(data.lat != null ? data.lat : params.lat),
          longitude: utils.roundCoord(data.lon != null ? data.lon : params.lon),
          distance_m: utils.distanceM(params.lat, params.lon,
            utils.roundCoord(data.lat != null ? data.lat : params.lat),
            utils.roundCoord(data.lon != null ? data.lon : params.lon)),
          width: null, height: null, fetched_at: utils.nowIso()
        }]
      };
    }).catch(function (e) {
      log('proxy Street View en échec', e);
      return { provider: 'street-view-proxy', items: [], error: 'proxy indisponible' };
    });
  }

  /* ------------- Fournisseur facultatif : Mapillary (proxy) ------------- */
  function mapillaryProxyFindImages(params) {
    if (!cfg.images.mapillaryProxy) return Promise.resolve({ provider: 'mapillary-proxy', items: [] });
    var url = new URL(cfg.images.mapillaryProxy, window.location.href);
    url.searchParams.set('lat', String(params.lat));
    url.searchParams.set('lon', String(params.lon));
    url.searchParams.set('radius', String(params.radiusM || 60));
    return utils.fetchJson(url.href, { headers: { 'Accept': 'application/json' } }).then(function (data) {
      var list = (data && data.images) || [];
      var items = list.slice(0, 8).map(function (img) {
        if (!utils.isAllowedUrl(img.url, [])) return null;
        return {
          url: img.url, thumb_url: img.thumb_url || img.url,
          source: 'Mapillary (proxy)', type: 'street_view',
          title: 'Vue de rue Mapillary', page_url: img.page_url || '',
          license: utils.cleanText(img.license || 'CC-BY-SA (Mapillary)', 120),
          author: utils.cleanText(img.author || 'Mapillary', 120),
          credit: '', description: '',
          latitude: utils.roundCoord(img.lat), longitude: utils.roundCoord(img.lon),
          distance_m: utils.distanceM(params.lat, params.lon,
            utils.roundCoord(img.lat), utils.roundCoord(img.lon)),
          width: null, height: null, fetched_at: utils.nowIso()
        };
      }).filter(Boolean);
      items.sort(function (a, b) { return a.distance_m - b.distance_m; });
      return { provider: 'mapillary-proxy', items: items };
    }).catch(function (e) {
      log('proxy Mapillary en échec', e);
      return { provider: 'mapillary-proxy', items: [], error: 'proxy indisponible' };
    });
  }

  /* ---------------- Registre des fournisseurs ---------------- */
  var PROVIDERS = {
    'wikimedia-commons': commonsFindImages,
    'esri-aerial': esriAerialFindImages,
    'street-view-proxy': streetViewProxyFindImages,
    'mapillary-proxy': mapillaryProxyFindImages
  };
  CPGeo.images = CPGeo.images || {};
  CPGeo.images.registerProvider = function (id, fn) { PROVIDERS[id] = fn; };

  /* ---------------- Recherche principale ----------------
     params = { lat, lon, radiusM }
     Résout : {
       items: [...toutes images, photos triées par distance puis replis...],
       photos: [...], aerial: item|null,
       providers_used: [...], errors: [...]
     }
     -------------------------------------------------------- */
  function findBuildingImages(params) {
    var enabled = (cfg.images.providers || []).filter(function (id) { return typeof PROVIDERS[id] === 'function'; });
    /* Les proxies optionnels s'ajoutent s'ils sont configurés */
    if (cfg.images.streetViewProxy && enabled.indexOf('street-view-proxy') === -1) enabled.push('street-view-proxy');
    if (cfg.images.mapillaryProxy && enabled.indexOf('mapillary-proxy') === -1) enabled.push('mapillary-proxy');
    if (!enabled.length) enabled = ['wikimedia-commons', 'esri-aerial'];

    return Promise.all(enabled.map(function (id) {
      return PROVIDERS[id](params).then(function (res) {
        return Object.assign({ id: id }, res);
      }).catch(function (e) {
        log('fournisseur image en échec', id, e);
        return { id: id, provider: id, items: [], error: (e && e.message) || 'erreur fournisseur' };
      });
    })).then(function (results) {
      var photos = [];
      var aerial = null;
      var errors = [];
      results.forEach(function (res) {
        if (res.error) errors.push({ provider: res.provider || res.id, error: res.error });
        (res.items || []).forEach(function (item) {
          if (item.type === 'satellite' || item.type === 'aerial') {
            if (!aerial) aerial = item;
          } else {
            photos.push(item);
          }
        });
      });
      photos.sort(function (a, b) { return a.distance_m - b.distance_m; });
      /* Dédupliquer les photos (même URL) */
      var seen = Object.create(null);
      photos = photos.filter(function (p) {
        if (seen[p.url]) return false;
        seen[p.url] = true;
        return true;
      });
      return {
        items: photos.concat(aerial ? [aerial] : []),
        photos: photos,
        aerial: aerial,
        providers_used: results.map(function (r) { return r.provider || r.id; }),
        errors: errors,
        searched_at: utils.nowIso()
      };
    });
  }

  CPGeo.images.findBuildingImages = findBuildingImages;
  CPGeo.images.aerialImageUrl = aerialImageUrl;
  CPGeo.images.staticMapTileUrl = staticMapTileUrl;
  CPGeo.images.osmPermalink = osmPermalink;
  CPGeo.images.lonToTileX = lonToTileX;
  CPGeo.images.latToTileY = latToTileY;
  CPGeo.images._commonsFindImages = commonsFindImages;
  CPGeo.images._stripHtml = stripHtml;
})(window);
