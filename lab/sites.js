'use strict';
// The pretend sites that have installed Friendface's pieces, plus Hop (redirector) and Pennant (advertising partner).
const ICON = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const home = (text) => async (c) => c.url.pathname === '/' && c.html(c.lab.SITES[c.site], `<p>${text}</p>`);
module.exports = {
  icon: (c) => c.send(200, 'image/png', ICON, { 'Cache-Control': 'max-age=31536000' }),
  hop: home('Friendface\'s link shortener. Nothing to see; links pass through.'),
  gazette: home('News from a harbour that does not exist.'),
  parcelpine: home('A shop for kite parts.'),
  'metrics.parcelpine': home('Metrics.'),
  tidewater: home('A blog about kites.'),
  loopreel: home('One short video.'),
  pennant: home('A pretend advertising company.'),
};
