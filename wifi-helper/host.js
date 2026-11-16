// Chrome native messaging host for C24. Chrome starts it, sends { type: 'list' } or
// { type: 'remove', uuids }, and reads the answer. Each message: 4-byte little-endian length, then JSON.
const wifi = require('./wifi.js');

// Chrome never sends a host more than a few bytes here; a huge length means a corrupt stream.
const MAX = 1024 * 1024;

function encode(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  const head = Buffer.alloc(4); head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
}

// Pure: takes everything received so far, returns the complete messages and the unfinished tail.
function decode(buf) {
  const messages = [];
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (len > MAX) throw new Error('message too large');
    if (buf.length < 4 + len) break;
    messages.push(JSON.parse(buf.subarray(4, 4 + len).toString()));
    buf = buf.subarray(4 + len);
  }
  return { messages, rest: Buffer.from(buf) };
}

// The extension only sends 'remove' after the user pressed Approve; wifi.remove still re-checks every UUID.
function handle(msg, run, now) {
  try {
    if (msg && msg.type === 'list')
      return { ok: true, type: 'list', canDelete: wifi.canDelete(run), candidates: wifi.candidates(wifi.list(run), now) };
    if (msg && msg.type === 'remove' && Array.isArray(msg.uuids))
      return { ok: true, type: 'remove', ...wifi.remove(run, msg.uuids, now) };
    return { ok: false, error: 'unknown request' };
  } catch (e) {
    return { ok: false, error: String(e.message) };
  }
}

if (require.main === module) {
  let rest = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    let got;
    try { got = decode(Buffer.concat([rest, chunk])); } catch { process.exit(1); }
    rest = got.rest;
    // stdout carries only framed answers: one stray byte there would break the channel.
    for (const m of got.messages) process.stdout.write(encode(handle(m, wifi.nmcli, Date.now())));
  });
}

module.exports = { encode, decode, handle };
