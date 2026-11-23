// QuoteCrafter private customer link: shared, dependency-free logic for view.html (browser) and the app's tests (Node).
// The estimate or invoice travels in the URL fragment (after #), which browsers never send to a web server.
// Nothing here makes a network request.

const enc = new TextEncoder(), dec = new TextDecoder('utf-8', {fatal: true});

export function toBase64Url(text) {
  let bin = '';
  for (const b of enc.encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw Error('This link is damaged. Ask the business to send it again.');
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4));
  return dec.decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

/** "#e1.…" estimate, "#i1.…" invoice, "#a1.…" a customer's approval on its way back to the business. */
export function readFragment(hash) {
  const m = /^#?([eia])1\.([A-Za-z0-9_-]{8,200000})$/.exec(hash || '');
  if (!m) throw Error('This link is incomplete. Ask the business to send it again.');
  let data;
  try { data = JSON.parse(fromBase64Url(m[2])); } catch { throw Error('This link is damaged. Ask the business to send it again.'); }
  if (!data || data.v !== 1) throw Error('This link was made by a newer QuoteCrafter. Ask the business for a PDF instead.');
  return {kind: {e: 'estimate', i: 'invoice', a: 'approval'}[m[1]], data};
}

/** The exact customer-facing scope the app signs (approvalScope): same keys, same order. */
export function rebuildScope(common, offer) {
  return JSON.stringify({
    ...(common.photos && common.photos.length ? {photos: common.photos} : {}),
    details: common.details, country: common.country, currency: common.currency,
    package: offer.package, lines: offer.lines, tax: offer.tax, totals: offer.totals, deposit: offer.deposit,
    consent: common.consent,
  });
}

/** Signature strokes on a 0–1000 grid as "x,y x,y|x,y …" (short enough for an email or text). */
export function packStrokes(strokes) { return strokes.map(s => s.map(p => p[0] + ',' + p[1]).join(' ')).join('|'); }
export function unpackStrokes(text) {
  if (typeof text !== 'string' || text.length > 12000 || !/^[0-9, |]+$/.test(text)) throw Error('The signature is damaged.');
  return text.split('|').map(s => s.split(' ').map(p => p.split(',').map(Number)));
}

export function approvalFragment(approval) { return '#a1.' + toBase64Url(JSON.stringify({v: 1, ...approval})); }

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function money(cents, currency, fr = false) {
  return new Intl.NumberFormat(fr ? 'fr-CA' : currency === 'USD' ? 'en-US' : 'en-CA', {style: 'currency', currency}).format(cents / 100) + ' ' + currency;
}
