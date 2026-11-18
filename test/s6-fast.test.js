// S6: faster learning. Two visited sites are enough; one is enough when a site's own ID is seen being handed to another
// company that answers with an ID cookie of its own. All limits of F1 stay.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { FOLLOW_N, followNote, followFull, syncTokens, idHashes, carries } = require('../extension/learn.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const cookie = (domain, o = {}) => ({ name: 'uid', domain, value: 'u-3fa9c2d1e0', sameSite: 'no_restriction', ...o });
const FP = { name: '_ffp', domain: 'news.example', value: 'ffp.1.1700000000.k9x2m4q8r1t7' };
const req = async (bg, url, page, o = {}) => { await bg.request({ url, initiator: `https://www.${page}`, type: 'script', ...o }); await bg.settle(); };
const answer = async (bg, url, page, setCookie) => { await bg.answer({ url, initiator: `https://www.${page}`, type: 'script', responseHeaders: setCookie ? [{ name: 'Set-Cookie', value: setCookie }] : [] }); await bg.settle(); };
const stopped = (bg) => bg.state.storage.stopped || [];
const asked = (bg) => ((bg.state.storage.pending || {}).unknown || { items: [] }).items.filter((i) => i.kind === 'tracker').map((i) => i.site);   // "Stop it?" questions
const SET = 'tid=t-77ab12cd34ef; Path=/; Max-Age=31536000; SameSite=None; Secure';

test('two visited sites and a cookie of that company are enough; one site is not', async () => {
  assert.equal(FOLLOW_N, 2);
  const bg = await load(on({ cookies: [cookie('.trk.example')] }));
  await req(bg, 'https://px.trk.example/p.gif', 'news.example'); await req(bg, 'https://px.trk.example/p.gif', 'news.example'); assert.deepEqual(stopped(bg), []);
  await req(bg, 'https://px.trk.example/p.gif', 'shop.example'); assert.deepEqual(stopped(bg), ['trk.example']);
});
test('evidence also when the company tries to set an ID cookie that other sites can use (it is not saved any more): seen in its answer, kept as a yes or no', async () => {
  const bg = await load(on());
  await req(bg, 'https://px.trk.example/p.gif', 'news.example'); await answer(bg, 'https://px.trk.example/p.gif', 'news.example', SET);
  await req(bg, 'https://px.trk.example/p.gif', 'shop.example');
  assert.deepEqual(stopped(bg), ['trk.example']);
  assert.equal(/t-77ab12cd34ef|tid=/.test(JSON.stringify(bg.state.storage)), false, 'something of the cookie is stored');
  const plain = await load(on());   // a cookie that is no ID, or that other sites cannot use, is no evidence
  for (const sc of ['lang=en-US; SameSite=None; Secure', 'sid=s-77ab12cd34ef; SameSite=Lax', 'sid=s-77ab12cd34ef']) await answer(plain, 'https://cdn.quiet.example/a.js', 'news.example', sc);
  await req(plain, 'https://cdn.quiet.example/a.js', 'news.example'); await req(plain, 'https://cdn.quiet.example/a.js', 'shop.example'); await plain.alarm('sweep');
  assert.deepEqual(stopped(plain), []); assert.deepEqual(asked(plain), []);
});
test('at once, on the first site: the ID the site keeps for you is seen going to another company, in the address or in what is sent, and that company answers with an ID cookie', async () => {
  for (const how of ['address', 'form', 'body']) {
    const bg = await load(on({ cookies: [FP] }));
    await answer(bg, 'https://px.trk.example/kit.js', 'news.example', SET);
    const body = how === 'form' ? { requestBody: { formData: { fp: ['k9x2m4q8r1t7'] } } } : how === 'body' ? { requestBody: { raw: [{ bytes: new TextEncoder().encode('{"ev":"view","fp":"ffp.1.1700000000.k9x2m4q8r1t7"}').buffer }] } } : {};
    await req(bg, 'https://px.trk.example/e' + (how === 'address' ? '?fp=ffp.1.1700000000.k9x2m4q8r1t7' : ''), 'news.example', { method: 'POST', ...body });
    assert.deepEqual(stopped(bg), ['trk.example'], how);
    assert.equal(JSON.stringify(bg.state.storage).includes('k9x2m4q8r1t7'), false, 'the value is stored'); assert.equal(JSON.stringify(bg.reports).includes('k9x2m4q8r1t7'), false);
  }
});
test('not at once: no answer with an ID cookie (a cookie in the jar is not enough for one site), a value the page script cannot read, a short or plain value, the same company', async () => {
  const quiet = await load(on({ cookies: [FP, cookie('.victim.example')] }));   // the audit's kind of attack: a page hands its own ID to a company that has a cookie but never asked for anything
  await req(quiet, 'https://www.victim.example/x?u=k9x2m4q8r1t7', 'news.example'); await quiet.alarm('sweep');
  assert.deepEqual(stopped(quiet), []); assert.deepEqual(asked(quiet), []); assert.deepEqual(quiet.called('cookies.remove'), []);
  const hidden = await load(on({ cookies: [{ ...FP, httpOnly: true }] })); await answer(hidden, 'https://px.trk.example/kit.js', 'news.example', SET);
  await req(hidden, 'https://px.trk.example/e?fp=k9x2m4q8r1t7', 'news.example'); assert.deepEqual(stopped(hidden), []);
  const plain = await load(on({ cookies: [{ name: 'lang', domain: 'news.example', value: 'en-US' }, { name: 'n', domain: 'news.example', value: 'abc1234' }, { name: 't', domain: 'news.example', value: '1700000000' }] }));
  await answer(plain, 'https://px.trk.example/kit.js', 'news.example', SET);
  await req(plain, 'https://px.trk.example/e?l=en-US&n=abc1234&t=1700000000', 'news.example'); assert.deepEqual(stopped(plain), []);
  const own = await load(on({ cookies: [FP] })); await answer(own, 'https://cdn.news.example/a.js', 'news.example', SET);
  await req(own, 'https://cdn.news.example/e?fp=k9x2m4q8r1t7', 'news.example'); assert.deepEqual(stopped(own), []); assert.deepEqual(own.state.storage.follow || {}, {});
});
test('the F1 scenario under the new rules: frames of one page, a shared host, a host without cookies, Google, a company pages need', async () => {
  const CF = 'https://d111.cloudfront.net/a.js?u=k9x2m4q8r1t7';
  const frames = await load(on({ tabs: [{ id: 1, active: true, url: 'https://www.news.example/' }], cookies: [FP] }));
  for (const f of ['https://a.one.example', 'https://b.two.example']) { await frames.request({ url: 'https://cdn.plain.example/a.js', initiator: f, type: 'script', tabId: 1, frameId: 5 }); await frames.settle(); }
  await frames.alarm('sweep'); assert.deepEqual(stopped(frames), []);
  const shared = await load(on({ cookies: [FP, cookie('d222.cloudfront.net', { name: 'other' })] }));
  await answer(shared, CF, 'news.example', SET); await req(shared, CF, 'news.example');
  assert.deepEqual(stopped(shared), ['d111.cloudfront.net']); assert.deepEqual(await shared.names(), ['_ffp', 'other']);
  const bare = await load(on({ cookies: [FP] }));
  await req(bare, CF, 'news.example'); await req(bare, CF, 'shop.example'); await bare.alarm('sweep'); assert.deepEqual(stopped(bare), []);
  const needed = await load(on({ cookies: [FP] }));
  for (const u of ['https://www.google.de/x?u=k9x2m4q8r1t7', 'https://js.stripe.com/v3?u=k9x2m4q8r1t7', 'https://accounts.google.com/x?u=k9x2m4q8r1t7', 'https://www.recaptcha.net/x?u=k9x2m4q8r1t7']) {
    await answer(needed, u, 'news.example', SET); await req(needed, u, 'news.example'); await req(needed, u, 'shop.example'); }
  await needed.alarm('sweep'); assert.deepEqual(stopped(needed), []); assert.deepEqual(needed.state.storage.follow || {}, {});
});
test('still at most 10 by itself in an hour', async () => {
  const sites = Array.from({ length: 11 }, (_, i) => `trk${i}.example`);
  const bg = await load(on({ cookies: [FP] }));
  for (const s of sites) { await answer(bg, `https://px.${s}/kit.js`, 'news.example', SET); await req(bg, `https://px.${s}/e?fp=k9x2m4q8r1t7`, 'news.example'); }
  assert.equal(stopped(bg).length, 10); assert.deepEqual(asked(bg), ['trk10.example']);
});
test('the comparison: parts of 8 or more letters and digits mixed, or 16 or more digits; by hash, with the worker\'s own random value', () => {
  assert.deepEqual(syncTokens('ffp.1.1700000000.k9x2m4q8r1t7&x=abc1234&y=1234567890123456&z=abcdefghij'), ['k9x2m4q8r1t7', '1234567890123456']);
  const h = idHashes([FP, { name: 'h', value: 'zz99yy88xx77', httpOnly: true }], 'salt-a');
  assert.equal(h.size, 1); assert.equal([...h].some((x) => String(x).includes('k9x2')), false);
  assert.equal(carries(h, 'https://px.trk.example/e?fp=k9x2m4q8r1t7', 'salt-a'), true); assert.equal(carries(h, 'https://px.trk.example/e?fp=k9x2m4q8r1t8', 'salt-a'), false);
  assert.notDeepEqual([...idHashes([FP], 'salt-b')], [...h]);
  const t = Date.now(); syncTokens('a1'.repeat(500000)); carries(h, 'x'.repeat(1e6), 'salt-a'); assert.ok(Date.now() - t < 500, 'slow on a long text');
  let s = followNote(undefined, 't.example', 'px.t.example', 'news.example', false, 1); assert.equal(followFull(s['t.example']), false);
  s = followNote(s, 't.example', 'px.t.example', 'news.example', false, 2, true); assert.equal(followFull(s['t.example']), true); assert.equal(s['t.example'].sent, true);
});
