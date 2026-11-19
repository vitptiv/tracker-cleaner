'use strict';
// What the coded trip demands of each row that can be created here: the shape of the captured value.
// "created" and "sent" are checked in Chrome and on the wire by trip.js; "stored" and "shown" by /what-i-know.json and the page.
module.exports = {
  T1: /^ff_uid=u-[0-9a-f]{10}$/, T2: /^ff_session=s-[0-9a-f]{16} is Mara Lindqvist$/, T3: /^_ffp=ffp\.1\.\d{13}\.\d+$/, T4: /^_ffc=ffc\.1\.\d{13}\.c-[0-9a-f]{8}$/,
  T5: /^hop_id=h-[0-9a-f]{10}$/, T6: /^pn_uid=p-[0-9a-f]{10} is ff_uid=u-[0-9a-f]{10}$/, T7: /^pp_sid=m-[0-9a-f]{10}$/, T8: /^ff_frame=f-[0-9a-f]{10}$/,
  T9: /^key ff_copy = ffp\.1\.\d{13}\.\d+$/, T10: /^tab tab-[0-9a-f]+, page \d+$/, T11: /^database ff, key id = ffp\.1\./, T12: /^cache ff, entry \/ff-id = ffp\.1\./,
  T13: /^worker holds u-[0-9a-f]{10}$/, T14: /^usage \d+ bytes, quota \d+ bytes$/, T15: /^saved\.js says k-[0-9a-f]{10}$/, T16: /^If-None-Match: "t-[0-9a-f]{10}"$/,
  T17: /^compiled copy of http:\/\/testbook\.localhost:\d+\/kit\.js in \d+ code cache file/, T18: /^\d+ lab icons saved: http/, T19: /^\d+ lab addresses in History, first http:\/\/[\w.]+\.localhost:\d+\//,
  T20: /^https:\/\/testbook\.test:\d+ remembered with alternative server quic port \d+$/, T21: /^forced-HTTPS bit set for testbook\.test: the plain request http:\/\/testbook\.test:\d+\/hsts\/read arrived as https$/,
  T22: /^notifications: granted$/, T23: /^http:\/\/gazette\.localhost:\d+\/ \(came from nowhere\)$/, T24: /^address 127\.0\.0\.1, HeadlessChrome\/[\d.]+, [\w-]+, header pattern h-[0-9a-f]{6}$/,
  T25: /^fp-[0-9a-f]{8}$/, T26: /^Search \{"search_string":"kite repair"\}$/, T27: /^sha256 [0-9a-f]{64}: matches mara\.lindqvist@example\.test$/,
  T28: /^[\d.]+ s on http:\/\/gazette\.localhost:\d+\/, scrolled \d+%$/, T29: /^click c-[0-9a-f]{8} to http:\/\/tidewater/, T30: /^http:\/\/testbook\.localhost:\d+\/ to http:\/\/tidewater\.localhost:\d+\/post\/mending-a-kite, click c-/,
  T31: /^liked http:\/\/tidewater\.localhost:\d+\/post\/mending-a-kite$/, T32: /^tidewater\.localhost knows this account as tw-[0-9a-f]{6} \(Testbook app ID ffu-[0-9a-f]{10}\)$/,
  T33: /^Purchase 49 EUR, order o-[0-9a-f]{6}, event e-[0-9a-f]{8}$/, T35: /^\d+ keys, gap mean \d+ ms, spread \d+ ms; mouse \d+ moves, \d+ px$/, T36: /^open: \d+; closed: \d+$/,
};
