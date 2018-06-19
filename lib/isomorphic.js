if (typeof window !== 'undefined') {
  const fetch = window.fetch;

  // we force loading from the web version to take advantage of proxy settings.
  // When under electron, the node version is normally loaded
  const Pusher = require('pusher-js/dist/web/pusher')
} else {
    const Pusher = require('pusher-js')
}

module.exports = {
  fetch,
  Pusher,
};
