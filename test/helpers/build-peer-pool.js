const PeerPool = require('../../lib/peer-pool')

module.exports =
async function buildPeerPool (peerId, server) {
  const peerPool = new PeerPool({
    peerId,
    restGateway: server.restGateway,
    pubSubGateway: server.pubSubGateway,
  })
  await peerPool.initialize()

  peerPool.testDisconnectionEvents = []
  peerPool.onDisconnection(({peerId}) => {
    peerPool.testDisconnectionEvents.push(peerId)
  })

  peerPool.testInbox = []
  peerPool.onReceive(({senderId, message}) => {
    peerPool.testInbox.push({
      senderId,
      message: message.toString()
    })
  })

  peerPool.testTracks = {}
  peerPool.onTrack(({senderId, track}) => {
    let tracksForSender = peerPool.testTracks[senderId]
    if (!tracksForSender) {
      tracksForSender = {}
      peerPool.testTracks[senderId] = tracksForSender
    }
    tracksForSender[track.id] = track
  })

  return peerPool
}
