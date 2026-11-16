// Runs one of the extension's own pages (report.html) as Chrome would, inside a node:vm context: its scripts in the
// order the page names them, a document that is just enough for a thin page script (#out, #note, clicks), and the
// chrome fake of a loaded background (test/load-background.js), so a press goes all the way to background.js.
//   const page = await loadPage(bg);               the side panel
//   const page = await loadPage(bg, '?tab=1');     the same page in a tab of its own, about tab 1
//   await page.click('Delete', 'theme');           presses the first button whose label starts so (and whose message names that cookie)
const vm = require('node:vm'), fs = require('fs'), path = require('path');
const unesc = (x) => x.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

module.exports = async function loadPage(bg, search = '', file = 'report.html') {
  const dir = path.join(__dirname, '..', 'extension'), html = fs.readFileSync(path.join(dir, file), 'utf8');
  const el = (id) => ({ id, innerHTML: '', textContent: '', on: {}, addEventListener(type, f) { this.on[type] = f; }, querySelectorAll: () => [],
    querySelector(sel) { const all = / data-some="([^"]*)" data-all="([^"]*)"/.exec(this.innerHTML);
      if (sel === '[data-also]') return all ? page.also : null;
      return sel === 'button[data-all]' && all ? (page.all = { dataset: { some: unesc(all[1]), all: unesc(all[2]) }, textContent: unesc(all[1]) }) : null; } });
  const out = el('out'), note = el('note');
  const page = { out, note, copied: [], also: { checked: false, dataset: { also: 'kept' }, tick: async (on) => { page.also.checked = on; await out.on.change({ target: page.also }); } }, text: () => unesc(out.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')), settle: bg.settle };
  page.buttons = () => [...out.innerHTML.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, a, label]) => { const at = (k) => (new RegExp(` data-${k}="([^"]*)"`).exec(a) || [])[1];
    return { label: unesc(label), disabled: / disabled/.test(a), dataset: Object.fromEntries(['msg', 'act', 'copy'].filter((k) => at(k) !== undefined).map((k) => [k, unesc(at(k))])) }; });
  // a press: the button as the page script will see it; `code` stands for the row's value shown on the screen
  page.click = async (label, name) => { const b = page.buttons().find((x) => x.label.startsWith(label) && (name === undefined || (x.dataset.msg && JSON.parse(x.dataset.msg).name === name)));
    if (!b || b.disabled) throw new Error(`no button "${label}"${name ? ` for ${name}` : ''} to press`);
    b.code = { textContent: '' }; b.closest = (sel) => sel === 'button' ? b : { querySelector: () => b.code }; b.remove = () => { b.removed = true; };
    await out.on.click({ target: b }); await bg.settle(); return b; };
  page.tick = async (label, checked) => { const m = new RegExp(`<input type="checkbox" data-msg="([^"]*)"[^>]*> ${label}`).exec(out.innerHTML);
    if (!m) throw new Error(`no box "${label}"`);
    await out.on.change({ target: { dataset: { msg: unesc(m[1]) }, checked } }); await bg.settle(); };
  const ctx = vm.createContext({ chrome: bg.chrome, URL, URLSearchParams, console, location: { search },
    document: { getElementById: (id) => ({ out, note }[id] || null) }, navigator: { clipboard: { writeText: async (t) => { page.copied.push(t); } } } });
  for (const [, f] of html.matchAll(/<script src="([^"]+)"/g)) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  await bg.settle();
  return page;
};
