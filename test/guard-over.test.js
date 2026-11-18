// R3: the sign-in guard ends five minutes after the last sign-in page, and what it held is done then, not at the next
// quarter-hour sweep. (Found with the lab: the guard itself was right, the held work waited for the sweep.)
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const MIN = 60e3;
const start = async () => { const bg = await load({ storage: { master: true }, tabs: [{ id: 1, active: true, url: 'https://example.com/' }] });
  await bg.navigate(1, 'https://login.microsoftonline.com/common/oauth2/authorize?client_id=a&redirect_uri=b'); await bg.navigate(1, 'https://example.com/app'); await bg.settle(); return bg; };

// (1.25, L4: a test of the old hold on everything stood here; what a sign-in holds now is in l4-hold.test.js)
