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
const NET_BASE = 100010;   // dynamic rule ids: NET_BASE .. NET_BASE + 8 the header rules, NET_BASE + 10 .. the local network
const NET_TYPES = ['sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other'];
const FAMILIES = [['google.com', 'youtube.com', 'youtube-nocookie.com', 'gstatic.com', 'googleapis.com', 'googleusercontent.com', 'ggpht.com', 'googlevideo.com', 'ytimg.com'],
  ['microsoft.com', 'live.com', 'microsoftonline.com', 'office.com', 'office365.com', 'msauth.net', 'msftauth.net', 'sharepoint.com'],
  ['apple.com', 'icloud.com', 'cdn-apple.com']];
// This computer and the home network, by address only: localhost, 0.0.0.0, 127.x, 10.x, 172.16 to 172.31, 192.168.x,
// 169.254.x, and the IPv6 loopback, mapped, private and link-local ranges. The whole host must be one of them (a name
// before an @, a port and a closing dot are allowed for): "localhost.example", "127.0.0.1.example" or "x.localhost" never match.
// Chrome allows a pattern only 2 KB when compiled (the whole list in one was refused), so there is one short pattern per range.
const local = (hosts) => `^(https?|wss?)://([^/?#@]*@)?(${hosts})\\.?(:[0-9]+)?([/?#]|$)`, N = '\\.[0-9]+';
const LOCAL_RES = [local('localhost|0\\.0\\.0\\.0'), local(`127${N}${N}${N}`), local(`10${N}${N}${N}`), local(`172\\.(1[6-9]|2[0-9]|3[01])${N}${N}`), local(`192\\.168${N}${N}|169\\.254${N}${N}`),
  local('\\[(::1|::ffff:[0-9a-f:.]+|f[cd][0-9a-f][0-9a-f]:[0-9a-f:]*|fe[89ab][0-9a-f]:[0-9a-f:]*)\\]')];
// self: this extension's own id: what it asks itself (the settings program, Tor's port) is no page's request
const netRules = ({ cookies, tags, local, exempt = [], self, guardTabs = [] }) => {
  const tabs = [...new Set(guardTabs)].slice(0, 100);
  const ex = [...new Set(exempt)], all = FAMILIES.flat(), head = (list) => list.filter(Boolean).map((header) => ({ header, operation: 'remove' }));
  const requestHeaders = head([cookies && 'cookie', tags && 'if-none-match', tags && 'if-modified-since', tags && 'referer']), responseHeaders = head([cookies && 'set-cookie', tags && 'etag']);
  const strip = (id, condition) => ({ id, priority: 1, action: { type: 'modifyHeaders', requestHeaders, ...(responseHeaders.length ? { responseHeaders } : {}) }, condition: { domainType: 'thirdParty', resourceTypes: NET_TYPES, ...(tabs.length ? { excludedTabIds: tabs } : {}), ...condition } });
  return [...(!requestHeaders.length ? [] : [strip(NET_BASE, { excludedInitiatorDomains: [...new Set([...ex, ...all])], ...(ex.length ? { excludedRequestDomains: ex } : {}) }),
    ...FAMILIES.map((f, i) => strip(NET_BASE + 1 + i, { initiatorDomains: f, excludedRequestDomains: [...new Set([...ex, ...f])] }))]),
    ...(!local ? [] : LOCAL_RES.map((regexFilter, i) => ({ id: NET_BASE + 10 + i, priority: 1, action: { type: 'block' }, condition: { regexFilter, domainType: 'thirdParty', resourceTypes: NET_TYPES, ...(self ? { excludedInitiatorDomains: [self] } : {}) } })))];
};
if (typeof module !== 'undefined') module.exports = { NET_BASE, NET_TYPES, FAMILIES, LOCAL_RES, netRules };
