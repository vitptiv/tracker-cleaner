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
const NET_BASE = 100010;   // dynamic rule ids NET_BASE .. NET_BASE + 9
const NET_TYPES = ['sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other'];
const FAMILIES = [['google.com', 'youtube.com', 'youtube-nocookie.com', 'gstatic.com', 'googleapis.com', 'googleusercontent.com', 'ggpht.com', 'googlevideo.com', 'ytimg.com'],
  ['microsoft.com', 'live.com', 'microsoftonline.com', 'office.com', 'office365.com', 'msauth.net', 'msftauth.net', 'sharepoint.com'],
  ['apple.com', 'icloud.com', 'cdn-apple.com']];
// This computer and the home network, by address only: localhost, 0.0.0.0, 127.x, 10.x, 172.16 to 172.31, 192.168.x,
// 169.254.x, and the IPv6 loopback, mapped, private and link-local ranges. The whole host must be one of them (a name
// before an @, a port and a closing dot are allowed for): "localhost.example", "127.0.0.1.example" or "x.localhost" never match.
const LOCAL_RE = '^(https?|wss?)://([^/?#@]*@)?(localhost|0\\.0\\.0\\.0|127\\.[0-9]+\\.[0-9]+\\.[0-9]+|10\\.[0-9]+\\.[0-9]+\\.[0-9]+|172\\.(1[6-9]|2[0-9]|3[01])\\.[0-9]+\\.[0-9]+'
  + '|192\\.168\\.[0-9]+\\.[0-9]+|169\\.254\\.[0-9]+\\.[0-9]+|\\[(::1|::ffff:[0-9a-f:.]+|f[cd][0-9a-f][0-9a-f]:[0-9a-f:]*|fe[89ab][0-9a-f]:[0-9a-f:]*)\\])\\.?(:[0-9]+)?([/?#]|$)';
// self: this extension's own id: what it asks itself (the settings program, Tor's port) is no page's request
const netRules = ({ cookies, tags, local, exempt = [], self }) => {
  const ex = [...new Set(exempt)], all = FAMILIES.flat(), head = (list) => list.filter(Boolean).map((header) => ({ header, operation: 'remove' }));
  const requestHeaders = head([cookies && 'cookie', tags && 'if-none-match', tags && 'if-modified-since', tags && 'referer']), responseHeaders = head([cookies && 'set-cookie', tags && 'etag']);
  const strip = (id, condition) => ({ id, priority: 1, action: { type: 'modifyHeaders', requestHeaders, ...(responseHeaders.length ? { responseHeaders } : {}) }, condition: { domainType: 'thirdParty', resourceTypes: NET_TYPES, ...condition } });
  return [...(!requestHeaders.length ? [] : [strip(NET_BASE, { excludedInitiatorDomains: [...new Set([...ex, ...all])], ...(ex.length ? { excludedRequestDomains: ex } : {}) }),
    ...FAMILIES.map((f, i) => strip(NET_BASE + 1 + i, { initiatorDomains: f, excludedRequestDomains: [...new Set([...ex, ...f])] }))]),
    ...(!local ? [] : [{ id: NET_BASE + 9, priority: 1, action: { type: 'block' }, condition: { regexFilter: LOCAL_RE, domainType: 'thirdParty', resourceTypes: NET_TYPES, ...(self ? { excludedInitiatorDomains: [self] } : {}) } }])];
};
// While a sign-in is going on in a tab, nothing in that tab is blocked or changed (a session rule: tab numbers end with Chrome)
const GUARD_RULE = 1, guardRule = (tabIds) => ({ id: GUARD_RULE, priority: 3, action: { type: 'allow' }, condition: { tabIds: [...new Set(tabIds)].slice(0, 100), resourceTypes: ['main_frame', ...NET_TYPES] } });
if (typeof module !== 'undefined') module.exports = { NET_BASE, NET_TYPES, FAMILIES, LOCAL_RE, netRules, GUARD_RULE, guardRule };
