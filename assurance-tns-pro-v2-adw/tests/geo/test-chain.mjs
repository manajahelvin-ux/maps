/* Test 1 — Intégrité de la chaîne d'étapes Formly après insertion du
   module cp-geo. Garantit que le parcours de conversion n'est pas cassé :
   chaque data-go-to pointe vers un data-answer existant, l'ordre DOM est
   correct, l'étape géo ne bloque jamais le bouton « Suivant ». */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createDom, LP_DIR } from './helpers.mjs';

const dom = createDom();
const doc = dom.window.document;
const steps = [...doc.querySelectorAll('[data-form="step"]')];

function stepOf(node) { return steps.indexOf(node.closest('[data-form="step"]')); }

test('chaîne Formly : chaque data-go-to de contenu a un data-answer correspondant', () => {
  const answers = new Map();
  doc.querySelectorAll('[data-answer]').forEach((n) => {
    const a = n.getAttribute('data-answer');
    if (a) answers.set(a, n);
  });
  doc.querySelectorAll('.etape-content[data-go-to]').forEach((content) => {
    const target = content.getAttribute('data-go-to');
    assert.ok(answers.has(target),
      `data-go-to="${target}" (étape ${stepOf(content)}) sans data-answer correspondant`);
    const targetStep = stepOf(answers.get(target));
    const currentStep = stepOf(content);
    /* soit l'étape suivante (cas normal), soit la même étape
       (contenus alternatifs step-3/step-4), jamais une étape précédente */
    assert.ok(targetStep >= currentStep,
      `data-go-to="${target}" revient en arrière (${currentStep} -> ${targetStep})`);
  });
});

test('chaîne Formly : pas de data-answer dupliqué', () => {
  const seen = new Set();
  doc.querySelectorAll('[data-answer]').forEach((n) => {
    const a = n.getAttribute('data-answer');
    if (!a) return;
    assert.ok(!seen.has(a), `data-answer dupliqué : ${a}`);
    seen.add(a);
  });
});

test('insertion cp-geo : code-postal -> geo-entreprise -> societe dans l’ordre DOM', () => {
  const societeContent = doc.querySelector('[data-answer="code-postal"]');
  const geoContent = doc.querySelector('[data-answer="geo-entreprise"]');
  const existanteContent = doc.querySelector('[data-answer="societe"]');
  assert.ok(societeContent && geoContent && existanteContent);

  assert.equal(societeContent.getAttribute('data-go-to'), 'geo-entreprise',
    'l’étape société+CP doit pointer vers l’étape géo');
  assert.equal(geoContent.getAttribute('data-go-to'), 'societe',
    'l’étape géo doit pointer vers « société existante »');
  assert.equal(existanteContent.getAttribute('data-go-to'), 'nom-prenom',
    'la suite du parcours ne doit pas changer');

  assert.ok(stepOf(societeContent) < stepOf(geoContent), 'ordre DOM : société+CP avant géo');
  assert.ok(stepOf(geoContent) < stepOf(existanteContent), 'ordre DOM : géo avant société existante');
  assert.equal(stepOf(geoContent), stepOf(societeContent) + 1, 'l’étape géo est immédiatement après société+CP');
});

test('étape géo : data-card="true" (mécanisme Formly des étapes sans input)', () => {
  const geoStep = doc.querySelector('[data-answer="geo-entreprise"]').closest('[data-form="step"]');
  assert.equal(geoStep.getAttribute('data-card'), 'true');
});

test('étape géo : aucun input/select/textarea (le bouton Suivant reste actif)', () => {
  const geoStep = doc.querySelector('[data-answer="geo-entreprise"]').closest('[data-form="step"]');
  const inputs = geoStep.querySelectorAll('input, select, textarea');
  assert.equal(inputs.length, 0,
    'aucun champ formulaire statique n’est autorisé dans l’étape géo (validation Formly)');
  /* un seul data-go-to : pas d'ambiguïté pour le moteur */
  assert.equal(geoStep.querySelectorAll('[data-go-to]').length, 1);
  /* boutons de navigation présents */
  assert.ok(geoStep.querySelector('[data-form="next-btn"]'));
  assert.ok(geoStep.querySelector('[data-form="back-btn"]'));
});

test('étape géo : ancre #cpgeo-root + titre de section conformes au cahier des charges', () => {
  const geoStep = doc.querySelector('[data-answer="geo-entreprise"]').closest('[data-form="step"]');
  assert.ok(geoStep.querySelector('#cpgeo-root.cpgeo-root'));
  assert.match(geoStep.textContent, /Localisation et identification de votre entreprise/);
  assert.match(geoStep.textContent, /facultative/i, 'le caractère non bloquant doit être indiqué');
});

test('dernière étape inchangée : téléphone + consentement + submit', () => {
  const last = steps[steps.length - 1];
  assert.ok(last.querySelector('input[name="telephone"]'));
  assert.ok(last.querySelector('input[name="consentement"]'));
  assert.ok(last.querySelector('input[type="submit"][data-form="submit-btn"]'));
});

test('nombre d’étapes : 11 étapes dont 1 nouvelle (10 avant le module)', () => {
  assert.equal(steps.length, 11);
});

test('tracking : les scripts et paramètres existants sont préservés', () => {
  const html = doc.documentElement.outerHTML;
  assert.match(html, /GTM-53SH7D7F/);
  assert.match(html, /consent', 'default'|consent", "default"|'consent', 'default'/);
  assert.ok(doc.querySelector('script[src="lead-handler.js"]'));
  assert.ok(doc.querySelector('script[src="verification-sms.js"]'));
  assert.ok(doc.querySelector('script[src^="script.js"]'));
  assert.ok(doc.querySelector('input[name="source"]'));
  assert.ok(doc.querySelector('input[name="categorie"]'));
});

test('scripts cp-geo chargés après lead-handler et en defer', () => {
  const scripts = [...doc.querySelectorAll('script[src]')];
  const idxLead = scripts.findIndex((s) => s.getAttribute('src') === 'lead-handler.js');
  const idxGeo = scripts.findIndex((s) => (s.getAttribute('src') || '').startsWith('geo/'));
  assert.ok(idxLead > -1 && idxGeo > -1 && idxGeo > idxLead);
  scripts.filter((s) => (s.getAttribute('src') || '').startsWith('geo/')).forEach((s) => {
    assert.ok(s.hasAttribute('defer'), `${s.getAttribute('src')} doit être defer`);
  });
  assert.equal(scripts.filter((s) => (s.getAttribute('src') || '').startsWith('geo/')).length, 5);
});

test('fichiers du module tous présents sur le disque', () => {
  const files = [
    'geo/cp-geo.css', 'geo/cp-geo-core.js', 'geo/cp-geo-geocoding.js',
    'geo/cp-geo-images.js', 'geo/cp-geo-ui.js', 'geo/cp-geo-init.js',
    'geo/leaflet/leaflet.js', 'geo/leaflet/leaflet.css',
    'geo/leaflet/images/marker-icon.png', 'geo/leaflet/images/marker-shadow.png'
  ];
  const missing = files.filter((f) => !fs.existsSync(path.join(LP_DIR, f)));
  assert.deepEqual(missing, []);
});

dom.window.close();
