'use strict';
// P1 (1.29): the header rules (C29/C30, session rules) and the learned/C33/local rules (dynamic) are never absent while
// their row is on. Before: Chrome hands rules back with their fields in another order, so "is what is there what is
// wanted?" never said yes, and every look at the features took all ten session rules out and put them back one by one
// (7 times in five page loads, measured); a request to another company that fell into such a gap kept its cookies.
// Now: nothing changed = no call at all; a change = ONE call that removes and adds together (Chrome applies one call
// whole); only when Chrome refuses that call are the rules swapped one by one, each in a call of its own that removes
// the old one and adds the new one together, so a rule that works is never gone before its replacement is in.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { NET_BASE } = require('../extension/net-rules.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const HEAD = Array.from({ length: 10 }, (_, i) => NET_BASE + i);
const upd = (bg, kind) => bg.called(kind === 'session' ? 'declarativeNetRequest.updateSessionRules' : 'declarativeNetRequest.updateDynamicRules');
const removals = (bg, kind) => upd(bg, kind).filter((c) => (c.args[0].removeRuleIds || []).length).length;
const headIds = (bg) => bg.state.rules.map((r) => r.id).filter((id) => HEAD.includes(id)).sort();
const ID = 'xq7m2k9p4w1z8c3v';

test('P1 a: with nothing changed, looking at the features again and again issues no rule call at all, session or dynamic', async () => {
  const bg = await load(on({ storage: { stopped: ['trk.example'] }, tabs: [{ id: 1, active: true, url: 'https://news.example/' }] }));
  await bg.alarm('sweep');
  assert.deepEqual(headIds(bg), HEAD, 'the ten header rules are not installed');
  const s0 = upd(bg, 'session').length, d0 = upd(bg, 'dynamic').length;
  for (let i = 0; i < 10; i++) { await bg.navigate(1, `https://news.example/page${i}`); await bg.settle(); }
  for (let i = 0; i < 3; i++) await bg.alarm('sweep');
  await bg.fireAlarm('proxy'); await bg.settle();
  assert.equal(upd(bg, 'session').length - s0, 0, 'session rules were touched with nothing changed');
  assert.equal(upd(bg, 'dynamic').length - d0, 0, 'dynamic rules were touched with nothing changed');
});
test('P1 b, c: a changed set is swapped in ONE call that removes and adds together, and no header rule is ever missing in between', async () => {
  const bg = await load(on()); await bg.settle();
  assert.deepEqual(headIds(bg), HEAD);
  const from = bg.ruleLog.length, s0 = upd(bg, 'session').length;
  await bg.send({ type: 'siteOff', host: 'shop.example', on: true }); await bg.settle();   // the left-alone list of every header rule changes
  const calls = upd(bg, 'session').slice(s0);
  assert.equal(calls.length, 1, 'not exactly one session call for the change');
  assert.deepEqual([...calls[0].args[0].removeRuleIds].sort(), HEAD); assert.deepEqual(calls[0].args[0].addRules.map((r) => r.id).sort(), HEAD);
  assert.ok(bg.state.rules.every((r) => !HEAD.includes(r.id) || (r.condition.excludedRequestDomains || []).includes('shop.example')), 'the new rules are not the ones installed');
  for (const st of bg.ruleLog.slice(from).filter((x) => x.kind === 'session')) assert.deepEqual(st.ids.filter((id) => HEAD.includes(id)).sort(), HEAD, 'a header rule was missing at some point');
  // a rule that is no longer wanted goes in the same call: the row switched off removes, and adds nothing
  const s1 = upd(bg, 'session').length;
  await bg.send({ type: 'setMode', group: 'othertags', mode: 'off' }); await bg.settle();
  const off = upd(bg, 'session').slice(s1);
  assert.equal(off.length, 1); assert.ok(off[0].args[0].removeRuleIds.length > 0);
  assert.deepEqual(headIds(bg), HEAD.slice(0, 5), 'the cookie rules did not stay while the tag rules went');
});
test('P1 c: from the first full install on, through sweeps, page changes, a site switched off and on, and a sign-in tab, the cookie rules are there after every single rule call', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://news.example/' }] })); await bg.settle();
  const from = bg.ruleLog.length;
  await bg.alarm('sweep'); await bg.navigate(1, 'https://shop.example/'); await bg.settle();
  await bg.send({ type: 'siteOff', host: 'shop.example', on: true }); await bg.send({ type: 'siteOff', host: 'shop.example', on: false });
  await bg.navigate(1, 'https://accounts.google.com/signin'); await bg.settle(); await bg.navigate(1, 'https://news.example/'); await bg.settle();
  await bg.opens('https://a.example/'); await bg.opens('https://b.example/');
  for (const s of ['a.example', 'b.example']) { await bg.request({ url: `https://${s}/f/hit?c=${ID}`, initiator: `https://${s}`, type: 'image' }); await bg.settle(); }
  await bg.alarm('sweep');
  assert.ok(bg.blocks('https://a.example/f/hit'), 'the C33 block was not installed');
  const seen = bg.ruleLog.slice(from);
  assert.ok(seen.filter((x) => x.kind === 'session').length >= 3, 'the changes were not made at all');
  for (const st of seen.filter((x) => x.kind === 'session')) assert.deepEqual(st.ids.filter((id) => HEAD.slice(0, 5).includes(id)).sort(), HEAD.slice(0, 5), 'a cookie rule was missing at some point');
});
test('P1: the dynamic rules (a blocked host, the C33 rules, the local-network rules) are swapped the same way: one call, nothing missing in between', async () => {
  const bg = await load(on({ storage: { stopped: ['trk.example'] } })); await bg.settle();
  assert.ok(bg.blocks('https://trk.example/'));
  const mine = (ids) => ids.filter((id) => id > 100000).sort(), before = mine(bg.state.dynamic.map((r) => r.id)), from = bg.ruleLog.length, d0 = upd(bg, 'dynamic').length;
  await bg.opens('https://a.example/'); await bg.opens('https://b.example/');
  for (const s of ['a.example', 'b.example']) { await bg.request({ url: `https://${s}/f/hit?c=${ID}`, initiator: `https://${s}`, type: 'image' }); await bg.settle(); }
  await bg.alarm('sweep');
  const calls = upd(bg, 'dynamic').slice(d0);
  assert.equal(calls.length, 1, 'the C33 rules did not arrive in one call');
  assert.deepEqual(calls[0].args[0].removeRuleIds || [], [], 'rules that did not change were taken out');
  for (const st of bg.ruleLog.slice(from).filter((x) => x.kind === 'dynamic')) for (const id of before) assert.ok(st.ids.includes(id), `rule ${id} was missing at some point`);
  // a change to rules that are there (a site switched off changes the C33 rules' left-alone lists): one call, both lists, only the changed ones
  const d1 = upd(bg, 'dynamic').length, mark = bg.ruleLog.length;
  await bg.send({ type: 'siteOff', host: 'a.example', on: true }); await bg.settle();
  const learned = upd(bg, 'dynamic').slice(d1).filter((c) => [...(c.args[0].removeRuleIds || []), ...(c.args[0].addRules || []).map((r) => r.id)].some((id) => id > 100000));
  assert.equal(learned.length, 1); assert.ok(learned[0].args[0].removeRuleIds.length && learned[0].args[0].addRules.length);
  assert.equal(learned[0].args[0].removeRuleIds.includes(101000), false, 'the unchanged block of trk.example was taken out');
  for (const st of bg.ruleLog.slice(mark).filter((x) => x.kind === 'dynamic')) assert.ok(st.ids.includes(101000), 'the block of trk.example was missing at some point');
});
test('P1 d: a rule Chrome refuses is still named, the others are installed one by one, and the next look does not churn', async () => {
  const bg = await load(on()); const flip = async (mode) => { for (const group of ['othercookies', 'othertags']) await bg.send({ type: 'setMode', group, mode }); await bg.settle(); };
  await flip('off'); assert.deepEqual(headIds(bg), []);
  bg.refuse = (r) => r.id === NET_BASE; await flip('auto');
  assert.deepEqual((await bg.send({ type: 'state' })).notWorking, ['Other companies get no cookies or cache tags']);
  assert.deepEqual(headIds(bg), HEAD.slice(1), 'the rules Chrome takes were not installed');
  const s0 = upd(bg, 'session').length; await bg.alarm('sweep');
  assert.ok(upd(bg, 'session').slice(s0).every((c) => !(c.args[0].removeRuleIds || []).length), 'working rules were taken out while one is refused');
  assert.deepEqual((await bg.send({ type: 'state' })).notWorking, ['Other companies get no cookies or cache tags'], 'no longer named while still refused');
  bg.refuse = null; await bg.alarm('sweep');
  assert.equal((await bg.send({ type: 'state' })).notWorking, undefined, 'still named after Chrome took it'); assert.deepEqual(headIds(bg), HEAD);
});
test('P1 d: when Chrome refuses the new version of a rule that works, the old one stays in place (never a gap), it is named, and the others are replaced', async () => {
  const bg = await load(on()); await bg.settle();
  assert.deepEqual(headIds(bg), HEAD);
  const from = bg.ruleLog.length;
  bg.refuse = (r) => r.id === NET_BASE && (r.condition.excludedRequestDomains || []).includes('shop.example');
  await bg.send({ type: 'siteOff', host: 'shop.example', on: true }); await bg.settle();
  for (const st of bg.ruleLog.slice(from).filter((x) => x.kind === 'session')) assert.deepEqual(st.ids.filter((id) => HEAD.includes(id)).sort(), HEAD, 'a header rule was missing at some point');
  const now = Object.fromEntries(bg.state.rules.map((r) => [r.id, (r.condition.excludedRequestDomains || []).includes('shop.example')]));
  assert.equal(now[NET_BASE], false, 'the refused version is there?'); assert.equal(now[NET_BASE + 1], true, 'the others were not replaced');
  assert.deepEqual((await bg.send({ type: 'state' })).notWorking, ['Other companies get no cookies or cache tags']);
});
