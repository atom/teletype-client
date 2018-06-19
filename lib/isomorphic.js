let fetch, Pusher, RTCPeerConnection;

if (typeof window !== 'undefined') {
  fetch = window.fetch;

  require('webrtc-adapter')
  RTCPeerConnection = window.RTCPeerConnection;

  // we force loading from the web version to take advantage of proxy settings.
  // When under electron, the node version is normally loaded
  Pusher = require('pusher-js/dist/web/pusher')
} else {
  fetch = require('node-fetch')
  Pusher = require('pusher-js')
  RTCPeerConnection = require('wrtc').RTCPeerConnection
}

module.exports = {
  fetch,
  Pusher,
  RTCPeerConnection,
};
