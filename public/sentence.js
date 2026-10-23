// Draws a prompt as the sentence you finish: its words, a box for each blank,
// and what fills itself in. The home page and the prompt editor's preview
// both use it, so the preview is the real thing.

import { parse, autoValues, AUTO_FILLS } from './template.js?v=c133954c60';

// Rebuilds el's sentence (anything marked .keep stays). values: { [blankId]:
// text }. Returns the distinct blanks and every input in order; a blank used
// twice gets two inputs that stay in step (see wireSentence).
export function buildSentence(el, template, { values = {}, autos = autoValues() } = {}) {
  const { parts, blanks } = parse(template);
  for (const n of [...el.children]) if (!n.classList.contains('keep')) n.remove();
  const anchor = el.querySelector('.keep');
  const inputs = [];
  for (const p of parts) {
    let node;
    if (p.type === 'text') {
      node = document.createElement('span');
      node.className = 'lit';
      node.textContent = p.text;
    } else if (p.type === 'auto') {
      node = document.createElement('span');
      node.className = 'auto';
      node.textContent = autos[p.key] ?? '';
      node.title = `${AUTO_FILLS[p.key].label}, filled in for you`;
    } else {
      node = document.createElement('span');
      node.className = 'slot';
      const v = values[p.id] || '';
      node.dataset.value = v;
      const input = document.createElement('input');
      input.type = 'text';
      // One character of intrinsic width: the slot sizes itself to the text
      // (app.css?v=c133954c60), and a default-width input would hold a whole line open.
      input.size = 1;
      input.value = v;
      input.dataset.blank = p.id;
      input.autocomplete = 'off';
      input.autocapitalize = 'off';
      input.spellcheck = false;
      input.setAttribute('autocorrect', 'off');
      input.enterKeyHint = 'go';
      input.setAttribute('aria-label', p.name);
      const ghost = document.createElement('span');
      ghost.className = 'ghost';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.textContent = p.name;
      ghost.dataset.name = p.name;
      node.append(input, ghost);
      inputs.push(input);
    }
    el.insertBefore(node, anchor);
  }
  return { blanks, inputs };
}

// Once per element: keeps each slot sized to its text, and repeated blanks
// in step.
export function wireSentence(el) {
  el.addEventListener('input', e => {
    const input = e.target;
    if (!input.dataset?.blank) return;
    for (const other of el.querySelectorAll(`input[data-blank="${CSS.escape(input.dataset.blank)}"]`)) {
      if (other !== input) other.value = input.value;
      other.parentElement.dataset.value = input.value;
    }
  });
}

// The blanks' current text, by id.
export function valuesOf(inputs) {
  const out = {};
  for (const i of inputs) out[i.dataset.blank] = i.value;
  return out;
}
