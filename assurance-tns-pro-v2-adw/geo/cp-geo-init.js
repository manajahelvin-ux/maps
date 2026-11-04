/* =====================================================================
   cp-geo-init.js — Initialisation du module et API publique
   ---------------------------------------------------------------------
   - Monte l'interface si l'étape « Localisation et identification de
     votre entreprise » est présente dans la page ;
   - Expose window.cpGeo, consommé par lead-handler.js au moment de la
     soumission (fusion des données géographiques au lead) ;
   - Dégradation gracieuse : si un fichier du module manque, le
     formulaire principal continue de fonctionner normalement.
   ===================================================================== */
(function (window, document) {
  'use strict';

  var CPGeo = window.CPGeo = window.CPGeo || {};

  function init() {
    try {
      if (!CPGeo.ui || typeof CPGeo.ui.mount !== 'function') return;
      CPGeo.ui.mount();
    } catch (e) {
      CPGeo.log('échec d’initialisation du module géo', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ============================ API publique ============================ */
  window.cpGeo = Object.freeze({
    version: CPGeo.version || '1.0.0',

    /* Payload complet destiné au CRM (objet structuré + champs plats).
       Appelé par lead-handler.js à la soumission du formulaire. */
    getLeadPayload: function () { return CPGeo.getLeadPayload(); },

    /* Données brutes du module (état des deux blocs + historique) */
    getData: function () { return CPGeo.getData(); },
    getLocation: function () { return CPGeo.getLocation(); },
    getBuilding: function () { return CPGeo.getBuilding(); },

    /* Statuts des deux composants */
    getStatus: function () {
      return {
        company_location: CPGeo.getLocation().status,
        company_building: CPGeo.getBuilding().status,
        location_validated: !!CPGeo.getLocation().validated,
        building_validated: !!CPGeo.getBuilding().validated
      };
    },

    /* Programmatique (QA / intégrations futures) */
    validateLocation: function () { return CPGeo.validateLocation(); },
    validateBuilding: function () { return CPGeo.validateBuilding(); },
    reset: function () { CPGeo.reset(); CPGeo.ui && CPGeo.ui.renderAll && CPGeo.ui.renderAll(); },

    /* Configuration effective (lecture seule) */
    config: CPGeo.config
  });
})(window, document);
