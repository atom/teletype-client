let fetch, Pusher;

if (typeof window !== 'undefined') {
  fetch = window.fetch;

  // we force loading from the web version to take advantage of proxy settings.
  // When under electron, the node version is normally loaded
  Pusher = require('pusher-js/dist/web/pusher')
} else {
  fetch = require('node-fetch')
  Pusher = require('pusher-js')
}

module.exports = {
  fetch,
  Pusher,
};
