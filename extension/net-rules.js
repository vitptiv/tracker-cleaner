// What other companies get from the pages you visit, as declarativeNetRequest rules (S4, S5, S8). Pure: background.js
// passes what is switched on and whom to leave alone, and installs what comes back.
//   cookies  a request to another company carries no cookie and may set none (C29)
//   tags     it carries no cache tag (If-None-Match, If-Modified-Since) and no referring page, and gets no ETag (C30)
//   local    a page may not ask this computer or the home network (C31)
// "Another company" is Chrome's own test (domainType thirdParty: another registrable site than the one that asks).
// Left alone, as the one asked and as the one asking: `exempt` (sign-in hosts, the companies pages need for a captcha
// or a payment, sites the user switched cleaning off for). Requests inside one company's family of sites (Google to
// YouTube and the like) are left alone too, so that being signed in there keeps working. Hosts are matched by Chrome
// as whole names (a name and its subdomains), never as part of a longer name.
// guardTabs: the tabs a sign-in is going on in; there the header rules do not apply. Only a session rule can name
// tabs, so background.js installs the header rules as session rules (again at every start) and the local ones as dynamic.
const NET_BASE = 100010;   // rule ids: NET_BASE .. NET_BASE + 9 the header rules (session rules); the local network (dynamic rules): NET_BASE + 20 .. what pages ask, NET_BASE + 50 .. forms they post
const NET_TYPES = ['sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'other'];
// Google's hosts for sign-in and for services pages embed with a key that is checked against the referring page. Not all
// of googleapis.com: storage.googleapis.com serves anyone's files.
const GOOGLE_APIS = ['www', 'accounts', 'oauth2', 'securetoken', 'identitytoolkit', 'content', 'maps', 'places', 'youtube', 'fonts', 'ajax', 'translate', 'firestore', 'firebaseinstallations'].map((x) => x + '.googleapis.com');
// Google's own sites in other countries: one family with google.com
const GOOGLE_CC = ('ad ae al am as at az ba be bf bg bi bj bs bt by ca cat cd cf cg ch ci cl cm cn cv cz de dj dk dm dz ee es fi fm fr ga ge gg gl gm gr gy hn hr ht hu ie im iq is it je jo kg ki kz la li lk lt lu lv md me mg mk ml mn mu mv mw ne nl no nr nu pl pn ps pt ro rs ru rw sc se sh si sk sm sn so sr st td tg tl tm tn to tt vu ws '
  + 'co.ao co.bw co.ck co.cr co.id co.il co.in co.jp co.ke co.kr co.ls co.ma co.mz co.nz co.th co.tz co.ug co.uk co.uz co.ve co.vi co.za co.zm co.zw com.af com.ag com.ar com.au com.bd com.bh com.bn com.bo com.br com.bz com.co com.cu com.cy com.do com.ec com.eg '
  + 'com.et com.fj com.gh com.gi com.gt com.hk com.jm com.kh com.kw com.lb com.ly com.mm com.mt com.mx com.my com.na com.ng com.ni com.np com.om com.pa com.pe com.pg com.ph com.pk com.pr com.py com.qa com.sa com.sb com.sg com.sl com.sv com.tj com.tr com.tw com.ua com.uy com.vc com.vn').split(' ').map((x) => 'google.' + x);
const FAMILIES = [['google.com', ...GOOGLE_CC, 'youtube.com', 'youtube-nocookie.com', 'gstatic.com', ...GOOGLE_APIS, 'googleusercontent.com', 'ggpht.com', 'googlevideo.com', 'ytimg.com'],
  ['microsoft.com', 'live.com', 'microsoftonline.com', 'office.com', 'office365.com', 'msauth.net', 'msftauth.net', 'sharepoint.com'],
  ['apple.com', 'icloud.com', 'cdn-apple.com'],
  ['wikipedia.org', 'wikimedia.org', 'wiktionary.org', 'wikidata.org', 'mediawiki.org', 'wikibooks.org', 'wikiquote.org', 'wikisource.org', 'wikinews.org', 'wikiversity.org', 'wikivoyage.org']];
// This computer and the home network, by address only: localhost, 0.0.0.0, 127.x, 10.x, 172.16 to 172.31, 192.168.x,
// 169.254.x, and the IPv6 loopback, mapped, private and link-local ranges. The whole host must be one of them (a name
// before an @, a port and a closing dot are allowed for): "localhost.example" or "127.0.0.1.example" never match.
// Chrome allows a pattern only 2 KB when compiled (the whole list in one was refused), so there is one short pattern per range.
const local = (hosts) => `^(https?|wss?)://([^/?#@]*@)?(${hosts})\\.?(:[0-9]+)?([/?#]|$)`, N = '\\.[0-9]+';
const LOCAL_RES = [local('localhost|0\\.0\\.0\\.0'), local(`127${N}${N}${N}`), local(`10${N}${N}${N}`), local(`172\\.(1[6-9]|2[0-9]|3[01])${N}${N}`), local(`192\\.168${N}${N}|169\\.254${N}${N}`),
  local('\\[(::|::1|::ffff:[0-9a-f:.]+|::[0-9a-f]+:[0-9a-f]+)\\]'),   // the unspecified and loopback addresses, and an IPv4 address written the two old ways
  local('\\[(f[cd][0-9a-f][0-9a-f]|fe[89a-f][0-9a-f]):[0-9a-f:]*\\]'),   // fc00::/7 private, fe80::/10 link-local, fec0::/10 site-local
  local(`100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])${N}${N}|198\\.1[89]${N}${N}`)];   // 100.64 to 100.127: shared out to home routers; 198.18 and 198.19: test networks
// Names that only exist inside a home or office network (H5): anything ending in .local, .lan, .internal or .home.arpa,
// and fritz.box; and LOCAL_SUB, a name under localhost, which is blocked only for a page that is not itself under localhost.
// J7: also .home and .corp, easy.box, and a name of one word ("router", "nas"): such a name exists only inside a network.
// L11: also .intranet, o2.box, pi.hole, three names that makers of home routers hand out, and a private IPv4 address
// wrapped in IPv6 the 6to4 (2002:...) and NAT64 (64:ff9b::...) ways.
const LABELS = '([a-z0-9_-]+\\.)', LOCAL_NAMES = local(`${LABELS}+(local|lan|internal|home\\.arpa|home|corp|intranet)`), LOCAL_BOX = local(`${LABELS}*((fritz|easy|o2)\\.box|pi\\.hole)`),
  LOCAL_MAKER = local('localhost\\.localdomain|router\\.asus\\.com|tplinkwifi\\.net'), LOCAL_WRAPPED = local('\\[(2002|64:ff9b:):(7f[0-9a-f][0-9a-f]|a[0-9a-f][0-9a-f]|c0a8|ac1[0-9a-f]|a9fe):[0-9a-f:]*\\]'),
  LOCAL_ONE = local('[a-z0-9_-]+'), LOCAL_SUB = local(`${LABELS}+localhost`);
const LOCAL_ALL = [...LOCAL_RES, LOCAL_WRAPPED, LOCAL_NAMES, LOCAL_BOX, LOCAL_MAKER, LOCAL_ONE];
// self: this extension's own id: what it asks itself (the settings program, Tor's port) is no page's request
const netRules = ({ cookies, tags, local, exempt = [], self, guardTabs = [] }) => {
  const tabs = [...new Set(guardTabs)].slice(0, 100);
  const ex = [...new Set(exempt)], head = (list) => list.filter(Boolean).map((header) => ({ header, operation: 'remove' }));
  // one condition per asker: everyone outside the families, then each family asking outside itself
  const conds = [{ excludedInitiatorDomains: [...new Set([...ex, ...FAMILIES.flat()])], ...(ex.length ? { excludedRequestDomains: ex } : {}) },
    ...FAMILIES.map((f) => ({ initiatorDomains: f, excludedRequestDomains: [...new Set([...ex, ...f])] }))];
  const strip = (id, req, res, types, condition) => ({ id, priority: 1, action: { type: 'modifyHeaders', requestHeaders: head(req), ...(head(res).length ? { responseHeaders: head(res) } : {}) },
    condition: { domainType: 'thirdParty', resourceTypes: types, ...(tabs.length ? { excludedTabIds: tabs } : {}), ...condition } });
  const main = [cookies && 'cookie', tags && 'if-none-match', tags && 'if-modified-since'], answer = [cookies && 'set-cookie', tags && 'etag'];
  return [...(!head(main).length ? [] : conds.map((c, i) => strip(NET_BASE + i, main, answer, NET_TYPES, c))),
    // the referring page: not for an embedded frame (video players and maps check where they are shown)
    ...(!tags ? [] : conds.map((c, i) => strip(NET_BASE + conds.length + i, ['referer'], [], NET_TYPES.filter((t) => t !== 'sub_frame'), c))),
    // local: what a page of another site asks of a private target; and (J7) a form it posts there, which is a page change with a
    // method that sends something. Following a plain link to a private target stays possible.
    ...(!local ? [] : [[NET_TYPES, 20, {}], [['main_frame'], 50, { requestMethods: ['post', 'put', 'patch', 'delete'] }]].flatMap(([types, base, more]) => [...LOCAL_ALL, LOCAL_SUB].map((regexFilter, i) => ({ id: NET_BASE + base + i, priority: 1, action: { type: 'block' },
      condition: { regexFilter, domainType: 'thirdParty', resourceTypes: types, ...more, excludedInitiatorDomains: [...(self ? [self] : []), ...(regexFilter === LOCAL_SUB ? ['localhost'] : [])] } }))))];
};
if (typeof module !== 'undefined') module.exports = { NET_BASE, NET_TYPES, FAMILIES, GOOGLE_APIS, LOCAL_RES, LOCAL_NAMES, LOCAL_BOX, LOCAL_ONE, LOCAL_ALL, LOCAL_SUB, netRules };
