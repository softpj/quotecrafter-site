import {readFragment, rebuildScope, packStrokes, approvalFragment, leadFragment, requestId, sha256Hex, money, taxParts} from './view-core.js';

const app = document.getElementById('app');
const colors = ['#AE3D28', '#173E37', '#243E65'];
let FR = false;
const L = (en, fr) => FR ? fr : en;
const pct = rate => FR ? String(rate).replace('.', ',') + '\u00a0%' : rate + '%';
// One "Tax" row, or GST and the provincial tax (QST, PST, RST) as separate rows where the province charges both.
function taxRows(rate, cents, location, currency) {
  const parts = taxParts(rate, cents, location, currency);
  if (parts) return parts.map(p => [L(p.label, p.labelFr) + ' (' + pct(p.rate) + ')', money(p.cents, currency, FR)]);
  return [[L('Tax', 'Taxes') + (Number(rate) ? ' (' + pct(rate) + ')' : ''), money(cents, currency, FR)]];
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid instanceof Node ? kid : String(kid));
  return n;
}
// Native append/replaceChildren print null as text; drop empty parts first.
const clean = kids => kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false);
const put = (node, ...kids) => node.replaceChildren(...clean(kids));
const add = (node, ...kids) => node.append(...clean(kids));
const httpsLink = v => typeof v === 'string' && /^https:\/\/[^\s<>"']+$/.test(v.trim());
const day = ymd => { if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return ymd || ''; return new Date(ymd + 'T12:00:00Z').toLocaleDateString(FR ? 'fr-CA' : undefined, {year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'}); };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function brand(seller) {
  if (colors.includes(seller?.brandColor)) document.documentElement.style.setProperty('--accent', seller.brandColor);
  document.getElementById('bar-name').textContent = seller?.name || 'QuoteCrafter';
}
function sellerBlock(s) {
  return el('div', {class: 'muted'}, el('strong', {}, s.name), s.address ? el('div', {class: 'pre'}, s.address) : null,
    el('div', {}, [s.email, s.phone].filter(Boolean).join(' · ')), s.taxId ? el('div', {}, L('Tax registration ', 'N° d’inscription aux taxes : ') + s.taxId) : null);
}
function linesTable(lines, currency) {
  return el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, L('Item', 'Article')), el('th', {class: 'n'}, L('Qty', 'Qté')), el('th', {class: 'n'}, L('Amount', 'Montant')))),
    el('tbody', {}, lines.map(l => {
      const gross = Math.round(l.quantityMilli * l.unitCents / 1000), net = gross - Math.round(gross * l.discountBp / 10000);
      return el('tr', {}, el('td', {class: 'pre'}, l.description, l.discountBp ? el('div', {class: 'muted'}, (l.discountBp / 100) + L('% off', ' % de remise')) : null),
        el('td', {class: 'n'}, String(l.quantityMilli / 1000)), el('td', {class: 'n'}, money(net, currency, FR)));
    })));
}
function totalsBlock(rows) {
  return el('div', {class: 'totals'}, rows.map(([label, value, grand]) => el('div', {class: grand ? 'grand' : ''}, el('span', {}, label), el('span', {}, value))));
}

function signaturePad() {
  const canvas = el('canvas', {'aria-label': L('Signature pad. Sign with your finger, stylus or mouse.', 'Zone de signature. Signez avec le doigt, un stylet ou la souris.')});
  const strokes = []; let current = null;
  const ctx = canvas.getContext('2d');
  function size() { const r = canvas.getBoundingClientRect(); canvas.width = r.width * devicePixelRatio; canvas.height = r.height * devicePixelRatio; draw(); }
  function point(e) { const r = canvas.getBoundingClientRect(); return [Math.max(0, Math.min(1000, Math.round((e.clientX - r.left) / r.width * 1000))), Math.max(0, Math.min(1000, Math.round((e.clientY - r.top) / r.height * 1000)))]; }
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.lineWidth = 2.5 * devicePixelRatio; ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    for (const s of strokes) { ctx.beginPath(); s.forEach(([x, y], i) => { const px = x / 1000 * canvas.width, py = y / 1000 * canvas.height; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke(); }
  }
  canvas.addEventListener('pointerdown', e => { if (strokes.length >= 24) return; canvas.setPointerCapture(e.pointerId); current = [point(e)]; strokes.push(current); draw(); pad.onchange?.(); });
  canvas.addEventListener('pointermove', e => {
    if (!current) return; const p = point(e), last = current[current.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 6 || strokes.flat().length >= 600) return; current.push(p); draw();
  });
  const end = () => { if (current && current.length < 2) strokes.pop(); current = null; draw(); pad.onchange?.(); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  const pad = {canvas, strokes, clear() { strokes.length = 0; draw(); pad.onchange?.(); },
    valid() { const pts = strokes.flat(); return strokes.length > 0 && pts.length >= 6 && Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0])) >= 25; }};
  requestAnimationFrame(size); addEventListener('resize', size);
  return pad;
}

function renderEstimate(d) {
  brand(d.seller);
  const c = d.common, det = c.details || {}, title = (d.proposal ? L('Proposal ', 'Proposition ') : L('Estimate ', 'Soumission ')) + d.ref;
  document.title = title + ' · ' + d.seller.name;
  let chosen = d.offers.length === 1 ? d.offers[0] : (d.offers.find(o => o.id === d.recommended) || null);
  const expired = det.validUntil && det.validUntil < today();
  const offerArea = el('div'), approveArea = el('div', {class: 'card'});

  function showOffer() {
    offerArea.replaceChildren();
    if (!chosen) { offerArea.append(el('p', {class: 'muted'}, L('Choose a package to see its details.', 'Choisissez une option pour en voir les détails.'))); return; }
    const t = chosen.totals, rows = [[L('Subtotal', 'Sous-total'), money(t.subtotal, c.currency, FR)], ...taxRows(chosen.tax, t.tax, det.taxLocation, c.currency), [L('Total', 'Total'), money(t.total, c.currency, FR), true]];
    offerArea.append(el('div', {class: 'card'}, chosen.package ? el('h2', {}, chosen.package.name) : el('h2', {}, L('Price', 'Prix')), chosen.package?.description ? el('p', {class: 'pre muted'}, chosen.package.description) : null,
      linesTable(chosen.lines, c.currency), totalsBlock(rows),
      chosen.deposit ? el('p', {}, el('strong', {}, L('Deposit on approval: ', 'Acompte à l’approbation : ') + money(chosen.deposit.cents, c.currency, FR))) : null));
  }

  const packageCards = d.offers.length > 1 ? el('div', {class: 'card'}, el('h2', {}, L('Choose your option', 'Choisissez votre option')), el('div', {class: 'packages', role: 'radiogroup'},
    d.offers.map(o => {
      const input = el('input', {type: 'radio', name: 'pkg', value: o.id, checked: chosen === o});
      const card = el('label', {class: 'pkg' + (chosen === o ? ' on' : '')}, input, el('strong', {}, o.package.name), d.recommended === o.id ? el('span', {class: 'tag'}, L('Recommended', 'Recommandée')) : null,
        el('span', {class: 'price'}, money(o.totals.total, c.currency, FR)), o.package.description ? el('div', {class: 'muted pre'}, o.package.description) : null);
      input.addEventListener('change', () => { chosen = o; document.querySelectorAll('.pkg').forEach(x => x.classList.toggle('on', x === card)); showOffer(); update(); });
      return card;
    }))) : null;

  const consent = el('input', {type: 'checkbox'}), name = el('input', {type: 'text', autocomplete: 'name', maxlength: '160', placeholder: L('Your full name', 'Votre nom complet')});
  const pad = signaturePad(), approve = el('button', {disabled: true}, L('Approve and sign', 'Approuver et signer')), error = el('p', {class: 'error', role: 'alert'});
  function update() { approve.disabled = expired || !chosen || !consent.checked || !name.value.trim() || !pad.valid(); }
  consent.addEventListener('change', update); name.addEventListener('input', update); pad.onchange = update;
  approve.addEventListener('click', async () => {
    error.textContent = '';
    try {
      const scope = rebuildScope(c, chosen), at = new Date().toISOString();
      const fragment = approvalFragment({...(FR ? {lang: 'fr'} : {}), id: d.id, ref: d.ref, pkg: chosen.id, name: name.value.trim(), at, h: await sha256Hex(scope), s: packStrokes(pad.strokes)});
      const link = location.origin + location.pathname + fragment;
      const summary = L('I approve ', 'J’approuve ') + title + ' — ' + (det.job || '') + (chosen.package ? ' (' + chosen.package.name + ')' : '') + L(', total ', ', total de ') + money(chosen.totals.total, c.currency, FR) + '.\n\n' + L('Signed by ', 'Signé par ') + name.value.trim() + L(' on ', ' le ') + new Date(at).toLocaleString(FR ? 'fr-CA' : undefined) + '.\n\n' + L('Open this link to record the approval in QuoteCrafter:', 'Ouvrez ce lien pour enregistrer l’approbation dans QuoteCrafter :') + '\n' + link;
      const subject = L('Approved: ', 'Approuvée : ') + title + (det.job ? ' — ' + det.job : '');
      put(approveArea, el('h2', {}, L('Last step: send your approval', 'Dernière étape : envoyez votre approbation')),
        el('p', {}, L('Your approval is ready. Nothing has been sent yet. Send it to ', 'Votre approbation est prête. Rien n’a encore été envoyé. Envoyez-la à ') + d.seller.name + L(' so they can record it:', ' pour qu’elle puisse être enregistrée :')),
        el('div', {class: 'row'},
          el('a', {class: 'btn', href: 'mailto:' + encodeURIComponent(d.seller.email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(summary)}, L('Send by email', 'Envoyer par courriel')),
          d.seller.phone ? el('a', {class: 'btn ghost', href: 'sms:' + d.seller.phone.replace(/[^0-9+]/g, '') + '?&body=' + encodeURIComponent(summary)}, L('Send by text', 'Envoyer par texto')) : null,
          el('button', {class: 'ghost', onclick: async e => { try { await navigator.clipboard.writeText(summary); e.target.textContent = L('Copied', 'Copiée'); } catch { e.target.textContent = L('Copy failed', 'Échec de la copie'); } }}, L('Copy approval', 'Copier l’approbation'))),
        el('p', {class: 'muted'}, L('Keep this page open until you have sent it.', 'Gardez cette page ouverte jusqu’à l’envoi.')));
      approveArea.classList.add('ok');
    } catch (e) { error.textContent = L('The approval could not be prepared. Please try again, or reply to the business by email.', 'L’approbation n’a pas pu être préparée. Réessayez ou répondez à l’entreprise par courriel.'); }
  });

  add(approveArea, el('h2', {}, d.proposal ? L('Approve this proposal', 'Approuver cette proposition') : L('Approve this estimate', 'Approuver cette soumission')),
    expired ? el('p', {class: 'error'}, L('This ' + (d.proposal ? 'proposal' : 'estimate') + ' expired on ' + day(det.validUntil) + '. Ask ' + d.seller.name + ' for an updated one.', 'Cette ' + (d.proposal ? 'proposition' : 'soumission') + ' a expiré le ' + day(det.validUntil) + '. Demandez-en une nouvelle à ' + d.seller.name + '.')) : null,
    el('label', {class: 'check'}, consent, el('span', {}, c.consent)),
    el('p', {}, el('label', {}, L('Full name', 'Nom complet'), name)),
    el('p', {}, L('Signature', 'Signature')), pad.canvas,
    el('div', {class: 'row'}, approve, el('button', {class: 'ghost', onclick: () => pad.clear()}, L('Clear signature', 'Effacer la signature'))), error);

  put(app, 
    el('div', {class: 'card'}, el('p', {class: 'kicker'}, title), el('h1', {}, det.job || title),
      el('p', {}, L('Prepared for ', 'Préparée pour '), el('strong', {}, det.client || ''), det.site ? L(' · Work site: ', ' · Lieu des travaux : ') + det.site : ''),
      det.validUntil ? el('p', {class: 'muted'}, L('Valid until ', 'Valide jusqu’au ') + day(det.validUntil)) : null, sellerBlock(d.seller)),
    el('div', {class: 'card'}, det.notes ? [el('h2', {}, L('The work', 'Les travaux')), el('p', {class: 'pre'}, det.notes)] : null,
      det.exclusions ? [el('h2', {}, L('Not included', 'Non inclus')), el('p', {class: 'pre'}, det.exclusions)] : null,
      det.assumptions ? [el('h2', {}, L('Assumptions', 'Hypothèses')), el('p', {class: 'pre'}, det.assumptions)] : null,
      det.paymentTerms ? [el('h2', {}, L('Payment terms', 'Modalités de paiement')), el('p', {class: 'pre'}, det.paymentTerms)] : null,
      c.photos?.length ? el('p', {class: 'muted'}, FR ? c.photos.length + (c.photos.length === 1 ? ' photo est incluse' : ' photos sont incluses') + ' dans la copie PDF.' : c.photos.length + (c.photos.length === 1 ? ' photo is' : ' photos are') + ' included in the PDF copy.') : null),
    packageCards, offerArea, approveArea);
  showOffer(); update();
}

function renderInvoice(d) {
  brand(d.seller);
  const t = d.totals, title = L('Invoice ', 'Facture ') + d.number; document.title = title + ' · ' + d.seller.name;
  const pay = (d.pay || []).map(o => httpsLink(o.value)
    ? el('p', {}, el('a', {class: 'btn', href: o.value.trim(), rel: 'noopener noreferrer'}, L('Pay with ', 'Payer avec ') + o.label))
    : el('div', {}, el('strong', {}, o.label), el('p', {class: 'pre'}, o.value)));
  put(app, 
    el('div', {class: 'card'}, el('p', {class: 'kicker'}, title), el('h1', {}, t.balance > 0 ? money(t.balance, d.currency, FR) + L(' due', ' à payer') : L('Paid in full', 'Entièrement payée')),
      el('p', {}, L('Billed to ', 'Facturé à '), el('strong', {}, d.customer.name), d.customer.address ? el('div', {class: 'pre muted'}, d.customer.address) : null),
      el('p', {class: 'muted'}, L('Issued ', 'Émise le ') + day(d.issuedOn) + L(' · Due ', ' · Échéance le ') + day(d.dueOn)), sellerBlock(d.seller)),
    t.balance > 0 && pay.length ? el('div', {class: 'card'}, el('h2', {}, L('How to pay', 'Comment payer')), pay, el('p', {class: 'muted'}, FR ? 'Les paiements sont versés directement à ' + d.seller.name + '. Indiquez ' + d.number + ' comme référence.' : 'Payments go directly to ' + d.seller.name + '. Include ' + d.number + ' as the reference.')) : null,
    el('div', {class: 'card'}, el('h2', {}, L('Details', 'Détails')), linesTable(d.lines, d.currency),
      totalsBlock([[L('Subtotal', 'Sous-total'), money(t.subtotal, d.currency, FR)], ...taxRows(d.taxBp / 100, t.tax, '', d.currency), [L('Total', 'Total'), money(t.total, d.currency, FR)], ...(t.credits > 0 ? [[L('Credit notes', 'Notes de crédit'), '−' + money(t.credits, d.currency, FR)]] : []), ...(t.paid ? [[L('Paid', 'Payé'), '−' + money(t.paid, d.currency, FR)]] : []), [L('Balance due', 'Solde dû'), money(t.balance, d.currency, FR), true]]),
      d.notes ? el('p', {class: 'pre muted'}, d.notes) : null));
}

function renderApproval(d, hash) {
  document.title = L('Approval for ', 'Approbation de ') + d.ref;
  put(app, el('div', {class: 'card ok'}, el('p', {class: 'kicker'}, L('Customer approval', 'Approbation du client')), el('h1', {}, d.name + L(' approved ', ' a approuvé ') + d.ref),
    el('p', {}, L('Signed ', 'Signée le ') + new Date(d.at).toLocaleString(FR ? 'fr-CA' : undefined) + (d.pkg ? L(' · ' + d.pkg.toUpperCase() + ' package', ' · option ' + d.pkg.toUpperCase()) : '') + '.'),
    el('p', {}, L('Open this page on the iPhone, iPad or Mac where you use QuoteCrafter, then tap the button. QuoteCrafter records the approval only if it matches the estimate you sent.', 'Ouvrez cette page sur l’iPhone, l’iPad ou le Mac où vous utilisez QuoteCrafter, puis touchez le bouton. QuoteCrafter enregistre l’approbation seulement si elle correspond à la soumission envoyée.')),
    el('p', {}, el('a', {class: 'btn', href: 'quotecrafter://approval' + hash}, L('Record in QuoteCrafter', 'Enregistrer dans QuoteCrafter')))));
}

const timings = [['soon', 'As soon as possible', 'Dès que possible'], ['month', 'Within a month', 'D’ici un mois'], ['flexible', 'Flexible timing', 'Moment flexible'], ['planning', 'Just planning for now', 'Simple planification pour l’instant']];
const contacts = [['email', 'Email', 'Courriel'], ['phone', 'Phone call', 'Appel'], ['sms', 'Text message', 'Texto']];

function renderRequest(d) {
  brand(d.seller);
  const s = d.seller;
  document.title = L('Request a quote · ', 'Demander une soumission · ') + s.name;
  const field = (label, input, hint) => el('p', {}, el('label', {}, label, hint ? el('span', {class: 'muted'}, ' ' + hint) : null, input));
  const text = (name, max, auto, type = 'text') => el('input', {type, name, maxlength: String(max), autocomplete: auto});
  const name = text('name', 160, 'name'), email = text('email', 254, 'email', 'email'), phone = text('phone', 80, 'tel', 'tel');
  const address = el('textarea', {name: 'address', maxlength: '600', rows: '2', autocomplete: 'street-address'});
  const title = text('title', 200, 'off'), scope = el('textarea', {name: 'scope', maxlength: '2000', rows: '5'});
  const radios = (group, options, first) => el('div', {class: 'choices', role: 'radiogroup'}, options.map(([value, en, fr], i) => el('label', {class: 'choice'}, el('input', {type: 'radio', name: group, value, checked: i === first}), el('span', {}, L(en, fr)))));
  const timing = radios('timing', timings, 2), contact = radios('contact', contacts, 0);
  const pick = group => document.querySelector('input[name=' + group + ']:checked')?.value || '';
  const send = el('button', {}, L('Prepare my request', 'Préparer ma demande')), error = el('p', {class: 'error', role: 'alert'}), done = el('div');
  send.addEventListener('click', () => {
    error.textContent = '';
    const v = {name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim(), address: address.value.trim(), title: title.value.trim(), scope: scope.value.trim(), timing: pick('timing'), contact: pick('contact')};
    if (!v.name) return void (error.textContent = L('Add your name.', 'Indiquez votre nom.'));
    if (!v.email && !v.phone) return void (error.textContent = L('Add an email address or a phone number so ' + s.name + ' can reply.', 'Indiquez un courriel ou un numéro de téléphone pour que ' + s.name + ' puisse vous répondre.'));
    if (v.email && !/^\S+@\S+\.\S+$/.test(v.email)) return void (error.textContent = L('Check the email address.', 'Vérifiez l’adresse courriel.'));
    if (v.contact === 'email' && !v.email || v.contact !== 'email' && !v.phone) v.contact = v.email ? 'email' : 'phone';
    if (!v.title) return void (error.textContent = L('Say briefly what work you need.', 'Décrivez brièvement les travaux souhaités.'));
    const at = new Date().toISOString(), link = location.origin + location.pathname + leadFragment({...(FR ? {lang: 'fr'} : {}), rid: requestId(), ...v, at});
    const when = timings.find(t => t[0] === v.timing), how = contacts.find(c => c[0] === v.contact);
    const body = [L('Quote request: ', 'Demande de soumission : ') + v.title, '', v.scope, '', L('Name: ', 'Nom : ') + v.name, v.email ? L('Email: ', 'Courriel : ') + v.email : '', v.phone ? L('Phone: ', 'Téléphone : ') + v.phone : '', v.address ? L('Work site: ', 'Lieu des travaux : ') + v.address : '',
      when ? L('Timing: ', 'Échéancier : ') + L(when[1], when[2]) : '', how ? L('Best way to reach me: ', 'Me joindre de préférence par : ') + L(how[1], how[2]) : '', '', L('QuoteCrafter users: open this link to add the request to Inquiries:', 'Utilisateurs de QuoteCrafter : ouvrez ce lien pour ajouter la demande aux demandes :'), link].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
    const subject = L('Quote request: ', 'Demande de soumission : ') + v.title;
    put(done, el('div', {class: 'card ok'}, el('h2', {}, L('Last step: send your request', 'Dernière étape : envoyez votre demande')),
      el('p', {}, L('Nothing has been sent yet. Send it to ', 'Rien n’a encore été envoyé. Envoyez-la à ') + s.name + ':'),
      el('div', {class: 'row'},
        el('a', {class: 'btn', href: 'mailto:' + encodeURIComponent(s.email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body)}, L('Send by email', 'Envoyer par courriel')),
        s.phone ? el('a', {class: 'btn ghost', href: 'sms:' + s.phone.replace(/[^0-9+]/g, '') + '?&body=' + encodeURIComponent(body)}, L('Send by text', 'Envoyer par texto')) : null,
        el('button', {class: 'ghost', onclick: async e => { try { await navigator.clipboard.writeText(body); e.target.textContent = L('Copied', 'Copiée'); } catch { e.target.textContent = L('Copy failed', 'Échec de la copie'); } }}, L('Copy request', 'Copier la demande'))),
      el('p', {class: 'muted'}, L('Photos help: attach a few to the email or text before you send it.', 'Des photos aident : joignez-en quelques-unes au courriel ou au texto avant l’envoi.'))));
    done.scrollIntoView({behavior: 'smooth', block: 'start'});
  });
  put(app,
    el('div', {class: 'card'}, el('p', {class: 'kicker'}, L('Request a quote', 'Demander une soumission')), el('h1', {}, s.name),
      el('p', {}, L('Tell us about the work. Your request goes straight to ', 'Décrivez les travaux. Votre demande est envoyée directement à ') + s.name + L(' by email or text, from your own device.', ' par courriel ou texto, depuis votre propre appareil.')),
      el('div', {class: 'muted'}, [s.email, s.phone].filter(Boolean).join(' · ')), httpsLink(s.website) ? el('div', {class: 'muted'}, el('a', {href: s.website.trim(), rel: 'noopener noreferrer'}, s.website.trim().replace(/^https:\/\//, ''))) : null),
    el('div', {class: 'card form'},
      field(L('What work do you need?', 'Quels travaux souhaitez-vous?'), title, L('for example “Replace the back deck”', 'par exemple « Remplacer la terrasse arrière »')),
      field(L('Details', 'Détails'), scope, L('sizes, materials, anything we should know', 'dimensions, matériaux, tout ce qu’il faut savoir')),
      el('p', {}, L('When would you like it done?', 'Pour quand souhaitez-vous les travaux?')), timing,
      field(L('Work site address', 'Adresse des travaux'), address),
      field(L('Your name', 'Votre nom'), name), field(L('Email', 'Courriel'), email), field(L('Phone', 'Téléphone'), phone),
      el('p', {}, L('Best way to reach you', 'Comment vous joindre de préférence')), contact,
      el('div', {class: 'row'}, send), error),
    done);
}

function renderLead(d, hash) {
  document.title = L('Quote request from ', 'Demande de soumission de ') + d.name;
  put(app, el('div', {class: 'card ok'}, el('p', {class: 'kicker'}, L('New quote request', 'Nouvelle demande de soumission')), el('h1', {}, d.title || ''),
    el('p', {}, L('From ', 'De ') + (d.name || '') + ' · ' + [d.email, d.phone].filter(Boolean).join(' · ')),
    d.scope ? el('p', {class: 'pre'}, d.scope) : null, d.address ? el('p', {class: 'muted pre'}, L('Work site: ', 'Lieu des travaux : ') + d.address) : null,
    el('p', {}, L('Open this page on the iPhone, iPad or Mac where you use QuoteCrafter, then tap the button to add it to Inquiries.', 'Ouvrez cette page sur l’iPhone, l’iPad ou le Mac où vous utilisez QuoteCrafter, puis touchez le bouton pour l’ajouter aux demandes.')),
    el('p', {}, el('a', {class: 'btn', href: 'quotecrafter://lead' + hash}, L('Add to QuoteCrafter', 'Ajouter à QuoteCrafter')))));
}

addEventListener('hashchange', () => location.reload());
try {
  const {kind, data} = readFragment(location.hash);
  FR = data.lang === 'fr';
  if (FR) document.documentElement.lang = 'fr-CA';
  const foot = document.querySelector('.foot p');
  if (foot && kind === 'request') foot.firstChild.textContent = L('This page sends nothing itself: your request goes from your own email or messaging app. ', 'Cette page n’envoie rien elle-même : votre demande part de votre propre application de courriel ou de messagerie. ');
  else if (foot && FR) foot.firstChild.textContent = 'Cette page affiche un document contenu dans le lien lui-même. Il n’est enregistré sur aucun serveur et cette page n’effectue aucune requête réseau. ';
  if (kind === 'estimate') renderEstimate(data); else if (kind === 'invoice') renderInvoice(data); else if (kind === 'request') renderRequest(data); else if (kind === 'lead') renderLead(data, location.hash); else renderApproval(data, location.hash);
} catch (e) {
  put(app, el('div', {class: 'card'}, el('h1', {}, L('This link can’t be opened', 'Ce lien ne peut pas être ouvert')), el('p', {}, e.message)));
}
