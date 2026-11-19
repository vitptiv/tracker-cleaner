// The tracker lists: the one place to edit. Then run: node extension/build.js
// (regenerates extension/rules*.json and extension/lists.js) and reload the extension.
// Rebuilt for 1.21 from 1.20's generated lists.js and rules.json; the original file was not in the source zip.

// Requests to these domains and their subdomains are blocked; any cookie on them is deleted.
const DOMAINS = [
  'doubleclick.net', 'google-analytics.com', 'googletagmanager.com', 'googlesyndication.com', 'googleadservices.com',
  'adservice.google.com', 'facebook.net', 'hotjar.com', 'hotjar.io', 'scorecardresearch.com', 'quantserve.com',
  'quantcount.com', 'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'adnxs.com', 'amazon-adsystem.com',
  'bat.bing.com', 'clarity.ms', 'segment.io', 'segment.com', 'mixpanel.com', 'mxpnl.com', 'amplitude.com',
  'analytics.tiktok.com', 'ads-twitter.com', 'analytics.twitter.com', 'px.ads.linkedin.com', 'snap.licdn.com',
  'ct.pinterest.com', 'nr-data.net', 'fullstory.com', 'mouseflow.com', 'mc.yandex.ru', 'chartbeat.com',
  'chartbeat.net', 'parsely.com', 'appsflyer.com', 'adjust.com', 'rubiconproject.com', 'pubmatic.com', 'openx.net',
  'casalemedia.com', 'demdex.net', 'omtrdc.net', 'everesttech.net', 'krxd.net', 'bluekai.com', 'mathtag.com',
  'rlcdn.com', 'tapad.com', 'agkn.com', 'crwdcntrl.net', 'moatads.com', 'doubleverify.com', 'adsrvr.org',
  'onesignal.com', 'braze.com', 'optimizely.com', 'ingest.sentry.io', 'sc-static.net', 'tr.snapchat.com',
  'stats.wp.com', 'standsapp.org',
];

// Cookie names deleted on any site (a prefix match unless the entry ends in $).
// LinkedIn: only its tracking names, not the li_ prefix (li_at is the login cookie). Mixpanel: mp_<token>_mixpanel only.
const COOKIE_RE = /^(_ga|_gid|_gat|_gcl_|__utm[a-z]|_fbp|_fbc|fr$|_hj|_uet|MUID$|IDE$|DSID$|test_cookie$|_pin_unauth|_tt_|_ttp$|_scid|_sctr|ajs_|mp_.*_mixpanel$|_clck|_clsk|amplitude|AMP_|_rdt_uuid|personalization_id|__qca|_parsely|optimizely|_mkto_trk|hubspotutk|__hs|_li_|li_sugr$|li_fat_id$|li_giant$|bcookie|lidc|AnalyticsSyncHistory|_cs_|_dc_gtm|_awl|_vwo|__gads|__gpi|_pk_|_ym_|yandexuid|_sp_id|_sp_ses|cto_|_cc_|uuid2$|anj$|tuuid|_chartbeat|sp_gaid$|sp_adid$|eyeo-|ttcsid|intercom-(id|device-id|session)-|bb_visitor_id$|cdn_visitor_id$|experiment_visitor_id$|sp_last_utm$|_dd_s|activitySessionId$|hmt_id$|WMF-Uniq$|WMF-Last-Access|GeoIP$)/;

// Google's and YouTube's own identity cookies (whole-name match), judged only on google.<tld> and youtube.com:
// their own group (C04), which asks by default, because sign-in and reCAPTCHA use NID.
const GOOGLE_RE = /^(NID|OTZ|1P_JAR|YSC|VISITOR_INFO1_LIVE|VISITOR_PRIVACY_METADATA|__Secure-YNID|__Secure-YEC|GPS)$/;

// Login / playback cookies never deleted by name or host rules (whole-name match).
const KEEP_RE = /^(sp_dc|sp_key|sp_t|sp_landing|sp_m|sp_new|sp_sso_csrf_token|__Host-device_id|__Host-sp_csrf_sid|OptanonConsent|OptanonAlertBoxClosed|sessionKey|sessionKeyLC|sessionKeyV3|sessionKeyV3LC|SID|HSID|SSID|APISID|SAPISID|LSID|OSID|SIDCC|AEC|PREF|LOGIN_INFO|ACCOUNT_CHOOSER|__Secure-ROLLOUT_TOKEN|__Secure-STRP|__Host-GAPS|__Host-[13]PLSID|__Secure-OSID|__Secure-[13]P(SID|APISID|SIDTS|SIDCC|SIDRTS))$/;

// Ad and telemetry paths on the sites' own domains (YouTube, Google), as declarativeNetRequest urlFilters.
const AD_PATHS = [
  '||youtube.com/pagead/', '||youtube.com/api/stats/ads', '||youtube.com/ptracking', '||youtube.com/get_midroll_',
  '||youtube.com/youtubei/v1/log_event', '||youtube.com/generate_204', '||youtube.com/pcs/activeview',
  '||google.com/pagead/', '||google.com/ads/', '||google.com/adsense/', '||googleapis.com/ads',
  '||play.google.com/log', '||google.com/gen_204', '||googlevideo.com/initplayback?*oad=',
];

// Tracking parameters stripped from the URL of a page being opened (C23). Never add a parameter a sign-in flow uses
// (state, code, client_id, redirect_uri, scope, nonce, token ...): test/build.test.js checks the usual ones.
const URL_PARAMS = [
  'gclid', 'dclid', 'gbraid', 'wbraid', 'gclsrc', 'fbclid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'igshid', 'mc_eid', 'mc_cid',
  '_hsenc', '_hsmi', 'mkt_tok', 'vero_id', 'oly_enc_id', 'oly_anon_id', 's_cid', 'li_fat_id',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
];

// Infrastructure cookies (whole-name match, a prefix where the name ends in .*): what load balancers keep a visitor on one
// server with (AWS ALB stickiness, Azure ARR affinity, F5 BIG-IP TS01...) and what bot protection sets (Cloudflare,
// Akamai, Imperva/Incapsula). They are set on every answer, often SameSite=None and with an ID-like value, by sites
// that track nobody. So they are NO EVIDENCE of tracking: the learning of companies on no list (C25: hasId and the
// Set-Cookie test in background.js) does not count them. They are not deleted for being on this list, nor kept.
// The vendor-made names are anchored to their formats (TS01 + 6-8 hex, incap_ses_<n>_<n>, visid_incap_<n>, nlbi_<n>[_<n>]),
// so a tracker cannot hide its own cookie behind a look-alike name such as TS01uid.
const INFRA_COOKIE_RE = /^(AWSALB|AWSALBCORS|AWSALBTG|AWSALBTGCORS|__cf_bm|_cfuvid|cf_clearance|__cflb|incap_ses_\d+_\d+|visid_incap_\d+|nlbi_\d+(_\d+)?|ak_bmsc|bm_sv|bm_sz|_abck|ARRAffinity|ARRAffinitySameSite|TS01[0-9a-f]{6,8})$/;

module.exports = { DOMAINS, COOKIE_RE, GOOGLE_RE, KEEP_RE, AD_PATHS, URL_PARAMS, INFRA_COOKIE_RE };
