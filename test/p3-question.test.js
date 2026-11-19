'use strict';
// P3 (1.29): the question about a company that really was seen on FOLLOW_N sites must come up. Traced through the lab
// trip: the host reached "seen on 2 sites, tried to set a cookie other sites can use" and was given one of the visited
// page's two question marks an hour (`q`, L5) -- and lost it at the next thing noted about it (the ID of the page handed
// to it, a second server name), because followNote() built the entry anew without `q`. It then asked the page for a
// mark again, as the third asker in the hour, was refused, and nothing was ever noted about it again: full evidence,
// no question, for good. The evidence asked for is unchanged, and so are the caps: a mark once given is only kept.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js').asks;
const { followNote, followFull, FOLLOW_N } = require('../extension/learn.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const SET = 'tid=t-77ab12cd34ef; Path=/; SameSite=None; Secure';
const req = async (bg, url, page) => { await bg.request({ url, initiator: `https://www.${page}`, type: 'script' }); await bg.settle(); };
const answer = async (bg, url, page) => { await bg.answer({ url, initiator: `https://www.${page}`, type: 'script', responseHeaders: [{ name: 'Set-Cookie', value: SET }] }); await bg.settle(); };
const questions = (bg) => ((bg.state.storage.pending || {}).unknown || { items: [] }).items.filter((i) => i.kind === 'tracker').map((i) => i.site);

test('P3: followNote keeps the mark that the company may be asked about, whatever is noted about it afterwards', () => {
  let st = followNote({}, 'trk.example', 'trk.example', 'salt a', true, 1); st = followNote(st, 'trk.example', 'trk.example', 'salt b', false, 2);
  assert.equal(st['trk.example'].on.length, FOLLOW_N); assert.ok(followFull(st['trk.example']));
  st['trk.example'] = { ...st['trk.example'], q: true };
  const sent = followNote(st, 'trk.example', 'trk.example', 'salt b', false, 3, true);          // the page's ID was handed to it
  assert.equal(sent['trk.example'].sent, true); assert.equal(sent['trk.example'].q, true, 'the mark was lost when "sent" was noted');
  const host = followNote(sent, 'trk.example', 'cdn.trk.example', 'salt b', false, 4);           // a second server name
  assert.equal(host['trk.example'].q, true, 'the mark was lost when a server name was noted');
  // and it is never made up: an entry without the mark stays without it
  const plain = followNote(followNote({}, 'x.example', 'x.example', 'salt a', false, 1), 'x.example', 'x.example', 'salt b', true, 2);
  assert.equal('q' in plain['x.example'], false);
});
test('P3: seen on two visited sites with a cookie of its own, then handed the page\'s ID and seen at a second address: the question is there and stays', async () => {
  const bg = await load(on({ cookies: [{ name: '_fp', domain: 'blog.example', value: 'k9x2m4q8r1t7' }] }));
  await answer(bg, 'https://trk.example/kit.js', 'news.example'); await req(bg, 'https://trk.example/kit.js', 'news.example');
  assert.deepEqual(questions(bg), [], 'asked after one site');
  // the second site: another candidate takes one of this page's two marks first, as in the trip (the kit's look at this computer)
  await req(bg, 'https://other.example/a.js', 'news.example'); await req(bg, 'https://other.example/a.js', 'blog.example');
  await req(bg, 'https://trk.example/kit.js', 'blog.example');                                   // seen on the second site: full, marked
  assert.equal(bg.state.storage.follow['trk.example'].q, true);
  await req(bg, 'https://trk.example/e?fp=k9x2m4q8r1t7', 'blog.example');                        // handed the page's own ID
  await req(bg, 'https://trk.example:8443/px.gif', 'blog.example');                              // the same host at another address
  assert.deepEqual(bg.state.storage.follow['trk.example'].hosts, ['trk.example', 'trk.example:8443']);
  const e = bg.state.storage.follow['trk.example'];
  assert.equal(e.sent, true); assert.equal(e.on.length, 2);
  assert.equal(e.q, true, 'the mark was lost');
  await bg.alarm('sweep');
  assert.deepEqual(questions(bg), ['trk.example'], 'no question although it was seen on two visited sites with a cookie of its own');
});
test('P3: the caps stay -- a third company that becomes full on the same page within the hour gets no mark and no question', async () => {
  const bg = await load(on());
  for (const h of ['t1.example', 't2.example', 't3.example']) { await answer(bg, `https://${h}/k.js`, 'news.example'); await req(bg, `https://${h}/k.js`, 'news.example'); }
  for (const h of ['t1.example', 't2.example', 't3.example']) { await answer(bg, `https://${h}/k.js`, 'blog.example'); await req(bg, `https://${h}/k.js`, 'blog.example'); }
  await bg.alarm('sweep');
  assert.deepEqual(questions(bg).sort(), ['t1.example', 't2.example']);
  assert.equal(bg.state.storage.follow['t3.example'].q, undefined);
});
test('P3: the evidence asked for is unchanged -- one site is not enough, and two sites without a cookie of its own make no question', async () => {
  const bg = await load(on());
  await answer(bg, 'https://trk.example/kit.js', 'news.example'); await req(bg, 'https://trk.example/kit.js', 'news.example'); await req(bg, 'https://cdn.trk.example/a.js', 'news.example');
  await req(bg, 'https://plain.example/lib.js', 'news.example'); await req(bg, 'https://plain.example/lib.js', 'blog.example');
  await bg.alarm('sweep');
  assert.deepEqual(questions(bg), []);
});
test('P3 ATTACK: a page that re-notes its companies again and again (new server names, its ID handed over) gets no mark beyond ASK_HOUR', async () => {
  const bg = await load(on({ cookies: [{ name: '_fp', domain: 'blog.example', value: 'k9x2m4q8r1t7' }] }));
  const T = ['t1.example', 't2.example', 't3.example', 't4.example', 't5.example'];
  for (const h of T) { await answer(bg, `https://${h}/k.js`, 'news.example'); await req(bg, `https://${h}/k.js`, 'news.example'); }
  for (const h of T) { await answer(bg, `https://${h}/k.js`, 'blog.example'); await req(bg, `https://${h}/k.js`, 'blog.example'); }
  const marked = () => T.filter((h) => bg.state.storage.follow[h].q === true);
  assert.deepEqual(marked(), ['t1.example', 't2.example']);
  // within the same hour the page keeps noting new things about every one of them, the marked ones first
  for (let round = 0; round < 3; round++) for (const h of T) {
    await req(bg, `https://${h}:${8440 + round}/p.gif`, 'blog.example');                      // another server address (port) each time
    await req(bg, `https://${h}/e${round}?fp=k9x2m4q8r1t7`, 'blog.example');                  // the page's own ID handed over
    await answer(bg, `https://${h}:${8440 + round}/p.gif`, 'blog.example'); }
  for (const h of T.slice(2)) assert.equal(bg.state.storage.follow[h].sent, true, `nothing new was noted about ${h}`);
  assert.equal(bg.state.storage.follow['t3.example'].hosts.length, 4, 'the other server addresses were not noted');
  assert.deepEqual(marked(), ['t1.example', 't2.example'], 'a mark beyond the cap');
  await bg.alarm('sweep');
  assert.deepEqual(questions(bg).sort(), ['t1.example', 't2.example']);
  // a new hour opens two new marks for that page, not more
  bg.now += 3600e3 + 1;
  for (const h of T.slice(2)) await req(bg, `https://${h}:8449/p.gif`, 'blog.example');
  assert.deepEqual(marked(), ['t1.example', 't2.example', 't3.example', 't4.example']);
});
