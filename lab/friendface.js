'use strict';
// Friendface: the pretend network. Its own pages, and the pieces other sites embed.
module.exports = async function friendface(c) {
  const { url } = c, path = url.pathname;
  if (path === '/') return c.html('Friendface', '<p>A pretend social network for the tracking lab. Everyone here is made up.</p>');
  return false;
};
