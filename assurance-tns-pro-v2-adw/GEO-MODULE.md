# Module cp-geo — Localisation et identification visuelle des entreprises

**Projet :** ComparateurPro — landing page `assurance-tns-pro-v2-adw`
**Version du module :** 1.0.0 — 2026-11-04
**Statut :** opérationnel, intégré au formulaire de collecte de leads, testé (63 tests automatisés — voir §9)

---

## 1. Vue d'ensemble

Le module ajoute au formulaire multi-étapes une nouvelle étape :
**« Localisation et identification de votre entreprise »**, placée juste après
la saisie *société + code postal* et avant *« Votre société existe-t-elle déjà ? »*.

Elle comporte deux blocs **strictement indépendants** :

| | Bloc A — Localisation | Bloc B — Bâtiment |
|---|---|---|
| Objet | Position géographique exacte (carte + GPS WGS84) | Photographie réelle du bâtiment + vue aérienne |
| Boutons | **Valider** / **Rechercher** (modale) | **Valider** / **Rechercher** (modale) |
| Carte | Leaflet + OpenStreetMap, marqueur **déplaçable** (géocodage inverse automatique) | Vue satellite Esri World Imagery (position exacte) |
| Images | Aperçu cartographique (tuile OSM) + permalink OSM | Photos géolocalisées Wikimedia Commons (licence + auteur + distance), vue de rue via proxy optionnel |
| États | non renseigné → recherche en cours → résultat trouvé → validé / erreur | idem + *en attente de validation* / *image indisponible* |

**Principes garantis par le code et par les tests :**
- l'étape est **facultative** : le bouton « Suivant » du formulaire n'est jamais
  désactivé par le module (aucun champ `required`, aucun `<input>` visible dans l'étape) ;
- la modification d'un bloc **n'écrase jamais** l'autre ;
- modifier une donnée validée **retire la validation** (elle doit être re-confirmée) ;
- **aucune image générique ou de voisin** n'est présentée comme le bâtiment exact :
  chaque photo affiche sa distance à l'adresse, un avertissement au-delà de 60 m,
  et si aucune photo fiable n'existe, un message explicite le dit (repli : vue aérienne) ;
- l'état survit au **rechargement de page** et aux **changements d'étape**
  (sessionStorage + champ caché `geo_json` dans le formulaire) ;
- **aucune clé API** n'est exposée côté client (fournisseurs par défaut sans clé ;
  fournisseurs à clé via proxy serveur — §5.3) ;
- le tracking existant (GTM/GA4/Google Ads, `ltm_source`, `ltm_category`, `ltm_typ`),
  la vérification SMS et la soumission CRM sont **inchangés** ; le module ne pousse
  **aucun événement dataLayer** par défaut (la conversion reste liée à la soumission).

---

## 2. Fichiers créés / modifiés

### Créés
```
geo/cp-geo.css            Styles du module (préfixés .cpgeo-, responsive, RGPD-friendly)
geo/cp-geo-core.js        Configuration, utilitaires, état des 2 blocs, persistance,
                          historique, payload CRM, bus d'événements
geo/cp-geo-geocoding.js   Géocodage : BAN (France) + Nominatim/OSM (Europe),
                          forward/reverse, throttle 1 req/s, normalisation WGS84
geo/cp-geo-images.js      Fournisseurs d'images : Wikimedia Commons, Esri World
                          Imagery (aérien), proxies optionnels Street View/Mapillary,
                          calcul de tuiles, contrôle des URL (liste blanche)
geo/cp-geo-ui.js          Blocs A/B, modales de recherche, cartes Leaflet (chargées
                          à la demande), galerie photos, badges de statut, messages
geo/cp-geo-init.js        Bootstrap + API publique window.cpGeo
geo/leaflet/              Leaflet 1.9.4 vendorisé (leaflet.js, leaflet.css, images/,
                          LICENSE) — aucune dépendance CDN
geo/examples/streetview-proxy.php.example
                          Exemple de proxy serveur pour Google Street View (clé API
                          côté serveur) — facultatif, non déployé par défaut
tests/geo/                Suite de tests automatisés (node:test + jsdom) — §9
GEO-MODULE.md             Ce document
```

### Modifiés (diffs minimaux, commentés)
```
index.html
  + <link rel="stylesheet" href="geo/cp-geo.css">            (head)
  ~ étape « société + code postal » : data-go-to="societe"  ->  data-go-to="geo-entreprise"
  + nouvelle étape <div data-form="step" data-card="true">   (squelette statique :
      titre, intro, conteneur #cpgeo-root, notice RGPD, boutons Précédent/Suivant)
  + 5 <script defer> geo/cp-geo-*.js                         (après verification-sms.js)

lead-handler.js
  + buildData()      : fusion window.cpGeo.getLeadPayload() → data.geo_entreprise_module
                       (objet JSON) + champs plats geo_* (try/catch : sans le module,
                       le lead part strictement inchangé)
  + buildSheetData() : liste blanche de champs plats geo_* pour Google Sheets
  + window.lpLead    : getLeadId() exposé (identifiant de lead partagé avec le module)
```

**Aucun autre fichier n'est modifié** : `script.js` (moteur Formly), `style.css`,
`verification-sms.js`, `fonts-global.css` sont intacts.

---

## 3. Intégration au moteur de formulaire (Formly)

Le formulaire est piloté par le moteur Formly (dans `script.js`, non modifié).
L'audit du moteur a établi que :

1. la navigation est **indexée sur l'ordre DOM** des `[data-form="step"]` et sur la
   chaîne `data-go-to` → `data-answer` ;
2. les étapes **sans champ** doivent porter `data-card="true"` : c'est le mécanisme
   officiel Formly (« Intro Cards Or Steps Without Inputs ») — `validation()`
   enregistre alors automatiquement la sélection `{step, selected: data-go-to}`, ce
   qui rend « Suivant » et « Précédent » pleinement fonctionnels ;
3. le bouton « Suivant » est désactivé uniquement par des champs
   `input[type=text][required]:visible`, `select[required]:visible`,
   `textarea[required]:visible` dans l'étape courante → **l'étape géo ne contient
   aucun `<input>`** (les champs de recherche vivent dans des modales rattachées au
   `<body>`, hors du formulaire) ;
4. aucun nom d'étape n'est codé en dur dans `script.js`.

Chaîne après intégration :
```
… → e-mail (etape-mail) → société + code postal (code-postal)
   → [NOUVELLE ÉTAPE] Localisation et identification (geo-entreprise, data-card)
   → société existante ? (societe) → nom/prénom (nom-prenom) → téléphone + consentement → Valider
```

Le test automatisé `test-chain.mjs` vérifie cette chaîne à chaque exécution
(11 assertions : ordre DOM, correspondance des `data-go-to`/`data-answer`, absence
d'inputs dans l'étape géo, dernière étape inchangée, scripts et GTM préservés).

---

## 4. Fournisseurs de données (sans clé API, usage autorisé)

| Usage | Fournisseur | Endpoint | Conditions respectées |
|---|---|---|---|
| Géocodage France (prioritaire) | **Base Adresse Nationale** (api.gouv.fr) | `api-adresse.data.gouv.fr/search/` et `/reverse/` | API publique ouverte, CORS, sans clé |
| Géocodage Europe + POI (nom d'entreprise) + repli France | **Nominatim / OpenStreetMap** | `nominatim.openstreetmap.org/search` / `/reverse` | **1 requête/s max** (file d'attente interne 1,1 s), `Accept-Language: fr`, Referer automatique, données © contributeurs OSM (ODbL) |
| Fonds de carte | **OpenStreetMap** | `tile.openstreetmap.org` (Leaflet, chargé à la demande) | Attribution affichée sur chaque carte ; tuiles utilisées en affichage cartographique normal |
| Photographies de bâtiments | **Wikimedia Commons** | `commons.wikimedia.org/w/api.php` (geosearch + imageinfo, `origin=*`) | Licence + auteur + page du fichier affichés pour chaque photo ; aucune réutilisation sans attribution |
| Vue aérienne / satellite | **Esri World Imagery** | `server.arcgisonline.com/.../World_Imagery/MapServer/tile/{z}/{y}/{x}` | Attribution affichée ; usage en affichage cartographique ; ⚠ pour un trafic publicitaire important, voir §10 (limites) |
| Référence de carte | **openstreetmap.org** | permalink `?mlat=…&mlon=…#map=…` | Lien simple |
| Aperçu cartographique enregistré | tuile OSM z17 | `map_image_url` | Attribution dans l'UI et la doc CRM |

Routage des recherches (`cp-geo-geocoding.js`) :
- **France + rue/CP/ville** → BAN d'abord ; < 3 résultats → complément Nominatim ; BAN injoignable → repli Nominatim ;
- **France + nom d'entreprise sans rue** → Nominatim (POI OSM : l'entreprise doit être cartographiée dans OSM) puis repli BAN sur la ville ;
- **Europe (BE, LU, CH, DE, ES, IT, NL, …)** → Nominatim avec `countrycodes` (lève les ambiguïtés de villes homonymes) ;
- codes postaux français à 5 chiffres passés en paramètre `postcode` de la BAN ;
- **marqueur déplacé** → géocodage inverse (BAN `reverse` en France, Nominatim `reverse` ailleurs), coordonnées exactes du marqueur préservées.

Toutes les coordonnées sont stockées en **WGS84** (décimaux, 6 chiffres ≈ 0,11 m).

---

## 5. Configuration

### 5.1 Par défaut (aucune installation requise)
Le module fonctionne immédiatement avec les fournisseurs ci-dessus. Aucune variable
d'environnement, aucune clé.

### 5.2 Surcharge côté page (optionnel)
```html
<script>
  window.CP_GEO_CONFIG = {
    debug: true,                          // logs console [cp-geo]
    pushDataLayerEvents: false,           // true = événements d'usage neutres (pas de conversion)
    images: {
      photoSearchRadiusM: 250,            // rayon de recherche des photos
      photoMaxReliableDistanceM: 60,      // seuil d'avertissement « vérifiez »
      providers: ['wikimedia-commons', 'esri-aerial']
    },
    nominatim: { minIntervalMs: 1100 }    // ne pas descendre sous 1000 (politique OSM)
  };
</script>
<!-- à placer AVANT geo/cp-geo-core.js -->
```

### 5.3 Fournisseurs d'images à clé (Google Street View, Mapillary) — optionnel
Les clés API **ne doivent jamais** apparaître dans le JavaScript public. Pour ajouter
une vue de rue : déployer un proxy serveur (exemple fourni :
`geo/examples/streetview-proxy.php.example`) puis :
```js
window.CP_GEO_CONFIG = { images: { streetViewProxy: 'https://votre-serveur/geo/streetview-proxy.php' } };
```
Le module interroge le proxy, valide l'URL renvoyée (liste blanche d'hôtes) et
affiche les photos avec `image_type: "street_view"`. Sans configuration, ces
fournisseurs sont simplement inactifs.

**Stockage durable des images côté serveur :** les URL enregistrées pointent vers les
fournisseurs (Wikimedia/Esri). Si le CRM exige des fichiers hébergés chez vous,
prévoir un endpoint d'aspiration (ex. `geo-image-store.php?url=…` validant la liste
blanche, téléchargeant, stockant et retournant une URL interne) et remplacer
`building_image_url` au moment de la soumission — schéma documenté dans l'exemple PHP.

---

## 6. Structure JSON enregistrée / transmise

### 6.1 État interne (sessionStorage `cp_geo_module_v1` + champ caché `geo_json`)
```json
{
  "module_version": "1.0.0",
  "search_id": "uuid-de-la-derniere-recherche",
  "lead_id": "uuid du lead (partagé avec lead-handler.js)",
  "created_at": "2026-11-04T10:00:00.000Z",
  "updated_at": "2026-11-04T10:05:00.000Z",
  "company_location": {
    "status": "validated",
    "search_id": "…", "company_name": "Boulangerie Dupont",
    "address": "12 Rue de la Paix 75002 Paris",
    "house_number": "12", "street": "Rue de la Paix",
    "postal_code": "75002", "city": "Paris",
    "country": "France", "country_code": "FR",
    "latitude": 48.8566, "longitude": 2.3522,
    "map_url": "https://www.openstreetmap.org/?mlat=…&mlon=…#map=17/…",
    "map_image_url": "https://tile.openstreetmap.org/17/66392/45092.png",
    "map_provider": "OpenStreetMap",
    "geocode_source": "BAN (Base Adresse Nationale)",
    "geocode_result_type": "housenumber",
    "searched_at": "…", "validated": true, "validated_at": "2026-11-04T10:05:00.000Z",
    "last_error": ""
  },
  "company_building": {
    "status": "validated",
    "search_id": "…",
    "address": "12 Rue de la Paix 75002 Paris",
    "postal_code": "75002", "city": "Paris", "country": "France", "country_code": "FR",
    "latitude": 48.8566, "longitude": 2.3522,
    "building_image_url": "https://upload.wikimedia.org/…jpg",
    "building_image_thumb_url": "https://upload.wikimedia.org/…/720px-…jpg",
    "image_source": "Wikimedia Commons",
    "image_type": "photo_exterieure | satellite | street_view",
    "image_license": "CC BY-SA 4.0", "image_author": "Jean Dupont",
    "image_page_url": "https://commons.wikimedia.org/wiki/File:…",
    "image_distance_m": 12,
    "aerial_image_url": "https://server.arcgisonline.com/…/tile/18/90184/132784",
    "aerial_provider": "Esri World Imagery",
    "searched_at": "…", "validated": true, "validated_at": "…",
    "last_error": "", "no_image_reason": ""
  },
  "history": [ { "at": "…", "block": "company_location", "action": "search|apply_result|validate|…", "…": "…" } ]
}
```
Statuts possibles : `empty`, `searching`, `found`, `pending`, `validated`, `error`,
`image_unavailable`.

### 6.2 Payload transmis au moment de la soumission du lead
`lead-handler.js` appelle `window.cpGeo.getLeadPayload()` et fusionne :

1. **`geo_entreprise_module`** — objet JSON structuré `{ module_version, search_id,
   lead_id, company_location {…conforme à votre spécification…}, company_building {…} }`
   (dans l'enveloppe CRM `{ payload: { formId, id, data } }`) ;
2. **champs plats `geo_*`** — pour des champs CRM individuels ou Google Sheets :

| Champ plat | Contenu |
|---|---|
| `geo_entreprise` | JSON complet (string, ≤ 8000 car.) |
| `geo_recherche_id` | identifiant de recherche unique |
| `geo_statut_localisation` / `geo_statut_batiment` | statut de chaque composant |
| `geo_adresse`, `geo_code_postal`, `geo_ville`, `geo_pays` | adresse normalisée (bloc A) |
| `geo_latitude`, `geo_longitude` | GPS WGS84 (bloc A) |
| `geo_carte_url`, `geo_carte_image_url`, `geo_carte_source` | référence + aperçu + source carte |
| `geo_geocodage_source` | BAN / Nominatim |
| `geo_localisation_validee` (`oui`/`non`), `geo_localisation_validee_le` | validation + date ISO |
| `geo_batiment_adresse`, `geo_batiment_code_postal`, `geo_batiment_ville`, `geo_batiment_pays` | adresse bâtiment |
| `geo_batiment_latitude`, `geo_batiment_longitude` | GPS bâtiment |
| `geo_batiment_image_url`, `geo_batiment_image_source`, `geo_batiment_image_type` | image + fournisseur + type |
| `geo_batiment_image_licence`, `geo_batiment_image_auteur`, `geo_batiment_image_page`, `geo_batiment_image_distance_m` | conformité de l'image |
| `geo_batiment_vue_aerienne_url`, `geo_batiment_vue_aerienne_source` | vue aérienne |
| `geo_batiment_valide`, `geo_batiment_valide_le`, `geo_batiment_sans_image_motif` | validation + motif d'indisponibilité |

Les champs vides ne sont pas transmis. **Les données ne sont considérées comme
enregistrées qu'après confirmation du backend** : elles empruntent le circuit de
confirmation existant du lead (CRM `cors` confirmé ou Sheets `status:"ok"`) ; en cas
d'échec, le message de réessai existant s'affiche et une nouvelle soumission
reconstruit le payload complet (état conservé en mémoire + sessionStorage).

### 6.3 Côté CRM HelloLead / Google Sheets (à faire par l'exploitant)
- **HelloLead** : enregistrer les champs `geo_*` ci-dessus pour le
  `formId: ADW_LP_ASSURANCE_TNS_PRO` (ou accepter le JSON `geo_entreprise_module`).
  Tant que les champs ne sont pas enregistrés côté CRM, ils sont transmis mais
  ignorés — **aucun risque pour les champs existants**.
- **Google Sheets (Apps Script)** : ajouter les colonnes `geo_*` souhaitées ;
  le script actuel ignore les colonnes inconnues sans erreur.

---

## 7. RGPD & sécurité

- **Information de l'utilisateur** : notice de finalité dans l'étape (adresse +
  coordonnées géographiques associées à la demande de devis), lien vers la politique
  de confidentialité existante ;
- **Minimisation** : seules l'adresse professionnelle et les coordonnées du bâtiment
  sont collectées ; pas de géolocalisation de l'appareil (l'API `geolocation` du
  navigateur n'est **jamais** appelée) ;
- **Conservation** : temporaire en sessionStorage (supprimée à la fermeture de
  l'onglet), puis durée de conservation du lead côté CRM/Sheets (politique existante) ;
- **Aucune clé API côté client** ; proxies recommandés pour les fournisseurs à clé ;
- **Contrôle des URL** : liste blanche d'hôtes (Wikimedia, Esri, OSM, gouv.fr,
  proxies configurés) sur toute URL enregistrée ou affichée ; échappement HTML
  systématique ; seules les clés connues entrent dans l'état (anti-injection, testé) ;
- **HTTPS uniquement** (tous les endpoints) ;
- **Consentement cookies inchangé** : le module ne dépose aucun cookie ; les appels
  API de géocodage/images sont strictement nécessaires à la fonctionnalité demandée
  par l'utilisateur. Le filtrage du tracking par consentement (`lead-handler.js`)
  n'est pas modifié ;
- **Licences** : OSM (ODbL, attribution affichée), Wikimedia Commons (licence de
  chaque fichier affichée + lien), BAN (licence ouverte Etalab), Esri World Imagery
  (attribution affichée — voir limite §10).

---

## 8. Tracking & conversions — préservés

- GTM `GTM-53SH7D7F`, Consent Mode v2, GA4, conversions Google Ads : **inchangés** ;
- `ltm_source`, `ltm_category`, `ltm_typ`, `utm_*`, click IDs : capturés, filtrés par
  consentement et transmis exactement comme avant (vérifié par test automatisé) ;
- événements `formulaire_lead` / `formulaire_micro_entrepreneur` : déclenchés
  uniquement à la soumission confirmée, comme avant ;
- le module **ne pousse aucun dataLayer event** par défaut
  (`pushDataLayerEvents: false`) — valider une localisation ou une image ne peut pas
  déclencher artificiellement une conversion ;
- redirection post-soumission via `ltm_typ` : inchangée.

---

## 9. Tests

### 9.1 Suite automatisée (63 tests, tous verts au 2026-11-04)
```bash
cd assurance-tns-pro-v2-adw/tests/geo
npm ci        # jsdom uniquement (dev)
npm test      # node --test --test-force-exit test-*.mjs
```
Aucun appel réseau réel : `fetch` est routé vers des fixtures fidèles aux formats
BAN / Nominatim / Wikimedia Commons.

| Fichier | Couverture | Tests |
|---|---|---|
| `test-chain.mjs` | Intégrité de la chaîne Formly après insertion de l'étape (navigation, non-blocage, tracking/scripts préservés, fichiers présents) | 11 |
| `test-core.mjs` | États des blocs, **indépendance A/B**, validations horodatées, dévalidation automatique en cas de modification, persistance/rechargement, champ caché, payload CRM structuré + plat, anti-injection (`__proto__`, clés inconnues), historique borné, façade `window.cpGeo`, zéro dataLayer | 12 |
| `test-geocoding.mjs` | BAN prioritaire en France (paramètres `q`/`postcode`), complément Nominatim, repli si BAN HS, **Belgique via Nominatim `countrycodes=be`**, recherche par nom d'entreprise (POI OSM), recherche vide, erreur réseau explicite, **throttle ≤ 1 req/s**, géocodage inverse FR (BAN) et Europe (Nominatim) avec préservation du point exact, normalisation WGS84 | 11 |
| `test-images.mjs` | Calcul de tuiles Web Mercator (valeurs de référence vérifiées par 2 formules indépendantes), filtrage Commons (titres non pertinents type « Carte… », images minuscules, **hôtes hors liste blanche rejetés**), tri par distance, licence/auteur/page extraits du HTML, repli vue aérienne si 0 photo, isolation des erreurs fournisseurs, proxy Street View désactivé par défaut | 8 |
| `test-lead-integration.mjs` | Fusion au payload HelloLead (`geo_entreprise_module` + `geo_*`), **même identifiant de lead**, champs Google Sheets, **tous les champs CRM existants strictement identiques avec/sans module**, `ltm_source/ltm_category/ltm_typ` préservés, filtrage sans consentement cookies, dégradation gracieuse sans le module | 8 |
| `test-ui-flow.mjs` | Parcours complets en DOM réel : montage, préremplissage depuis société/code postal, modale → recherche BAN → sélection → « Utiliser » → **Valider** (badge + message), adresse introuvable, erreur réseau, **aucune photo → message explicite + vue aérienne sélectionnable**, photo Commons avec distance/licence/auteur/avertissement > 60 m, rechargement de page, modification d'une localisation validée sans perdre la photo du bâtiment, accessibilité modale (dialog, ESC, focus), anti-doublon de recherche (cache), **régressions bloc B : nouvelle recherche à la même adresse → sélection/validation conservées ; recherche à une autre adresse → ancienne photo effacée ; aucune nouvelle photo au même point → repli sans écraser la sélection** | 13 |

### 9.2 Correspondance avec les 21 tests fonctionnels exigés

| # | Test exigé | Couverture |
|---|---|---|
| 1 | Entreprise française par adresse complète | ✅ auto (géocodage + UI) |
| 2 | Recherche par code postal + ville | ✅ auto (routage BAN) |
| 3 | Recherche par nom d'entreprise | ✅ auto (POI Nominatim) — résultat réel dépend de la présence dans OSM (limite §10) |
| 4 | Entreprise belge | ✅ auto (`countrycodes=be`) |
| 5 | Autre pays européen | ✅ auto (même chemin, liste de 28 pays) |
| 6 | Carte + coordonnées GPS | ✅ auto (UI) + 👁 manuel (tuiles réelles) |
| 7 | Photographie réelle du bâtiment | ✅ auto (Commons) + 👁 manuel sur adresse réellement photographiée |
| 8 | Sélection et validation d'une image | ✅ auto |
| 9 | Validation indépendante des deux blocs | ✅ auto |
| 10 | Modification d'une localisation validée | ✅ auto (dévalidation + bloc B conservé) |
| 11 | Modification d'une image validée | ✅ auto |
| 12 | Adresse introuvable | ✅ auto (message explicite) |
| 13 | Image indisponible | ✅ auto (message + repli aérien) |
| 14 | Plusieurs résultats pour une même adresse | ✅ auto (liste + présélection) |
| 15 | Actualisation de la page | ✅ auto (sessionStorage) |
| 16 | Passage d'une étape à l'autre | ✅ auto (chaîne Formly) + 👁 manuel navigateur |
| 17 | Soumission finale du formulaire | ✅ auto (payload) + 👁 manuel (SMS réel requis) |
| 18 | Données reçues côté backend | ⚠️ **manuel obligatoire** (environnement de prod) |
| 19 | Transmission HelloLead CRM | ⚠️ **manuel obligatoire** après enregistrement des champs `geo_*` côté CRM |
| 20 | Tracking et conversions | ✅ auto (préservation) + 👁 manuel Tag Assistant |
| 21 | Responsive mobile/ordinateur | ✅ CSS (media queries ≤ 640 px, modale plein écran) + 👁 manuel |

### 9.3 Checklist de recette manuelle avant mise en ligne
1. Ouvrir la LP, parcourir le formulaire jusqu'à l'étape géo : la carte et les
   modales fonctionnent avec de **vraies** API (réseau réel) ;
2. Rechercher une adresse connue (ex. « 12 rue de la Paix 75002 Paris ») : résultats
   BAN, marqueur déplaçable, géocodage inverse ;
3. Rechercher une adresse belge (ex. « Rue Royale 1000 Bruxelles ») ;
4. Bloc B sur un bâtiment photographié (ex. un monument) : photos Commons avec
   licence/auteur/distance ; sur une adresse quelconque : message « aucune
   photographie fiable » + vue aérienne ;
5. Recharger la page en cours de formulaire : l'étape géo est restaurée ;
6. Terminer le formulaire avec un vrai mobile (SMS) et vérifier dans
   `window.lpLead.preview()` (console) la présence de `geo_*`, puis la réception
   CRM/Sheets ;
7. Tag Assistant : `formulaire_lead` toujours unique à la soumission, aucun
   événement lié au module ;
8. Mobile : modales plein écran, cartes lisibles, boutons atteignables.

---

## 10. Limites techniques assumées

1. **Nom d'entreprise sans adresse** : la découverte par nom repose sur les POI
   OpenStreetMap (via Nominatim). Une entreprise non cartographiée dans OSM ne peut
   pas être trouvée par son seul nom — l'utilisateur saisit alors la rue (message
   d'aide affiché). La BAN ne référence pas les raisons sociales.
2. **Photographies de bâtiments** : Wikimedia Commons couvre très bien les centres
   villes et monuments, mais pas chaque bâtiment d'entreprise. C'est pourquoi la
   règle « aucune image plutôt qu'une image trompeuse » s'applique, avec repli sur la
   vue aérienne (position exacte) et branchement possible de Google Street View /
   Mapillary via proxy (§5.3) pour une couverture exhaustive.
3. **Esri World Imagery** : usage gratuit avec attribution pour l'affichage
   cartographique ; pour un volume publicitaire important, vérifier les conditions
   Esri ou basculer sur un fournisseur d'imagerie sous contrat (l'architecture
   `CPGeo.images.registerProvider` permet d'en ajouter un sans toucher au reste).
4. **Nominatim** : limité à 1 req/s par IP (politique OSM). À très fort trafic,
   prévoir un proxy interne de géocodage (même interface, `CP_GEO_CONFIG.nominatim.*Url`).
5. **Mode CRM `nocors` (sendBeacon)** : comme avant le module, ce transport ne
   confirme pas la réception ; la confirmation vient de Google Sheets ou du passage
   en `cors` (`UBE_CONFIG.leadApiMode`). Le module suit exactement ce contrat.
6. **Pas de géolocalisation de l'appareil** : volontaire (RGPD/minimisation) — la
   position vient de l'adresse saisie, ajustable manuellement sur la carte.
7. **Stockage navigateur** : sessionStorage = survie au rechargement, pas au
   changement d'onglet/fermeture ; la persistance définitive est la soumission du
   lead (backend). Le champ caché `geo_json` garantit que les données voyagent aussi
   avec le DOM du formulaire.

---

## 11. API publiques pour QA/intégration

```js
window.cpGeo.getStatus()        // { company_location, company_building, …_validated }
window.cpGeo.getData()          // état complet (voir §6.1)
window.cpGeo.getLeadPayload()   // { structured, flat } — ce qui part au CRM
window.cpGeo.validateLocation() / validateBuilding() / reset()
window.lpLead.getLeadId()       // identifiant du lead (partagé)
window.lpLead.preview()         // payload CRM complet incluant geo_* (existant, étendu)
window.CPGeo.config             // configuration effective (lecture)
```
