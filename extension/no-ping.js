// A link can carry a "ping": an address that is told which link you followed (hyperlink auditing). It is taken off
// the link the moment you press it, so nobody is told. Runs in every page and frame; it changes nothing else.
for (const ev of ['pointerdown', 'mousedown', 'click', 'auxclick', 'contextmenu', 'keydown'])
  addEventListener(ev, (e) => { const a = e.target && e.target.closest && e.target.closest('a[ping], area[ping]'); if (a) a.removeAttribute('ping'); }, true);
