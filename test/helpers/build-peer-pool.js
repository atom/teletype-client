const PeerPool = require('../../lib/peer-pool')

module.exports =
async function buildPeerPool (peerId, oauthToken, server) {
  const peerPool = new PeerPool({
    peerId,
    oauthToken,
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
  return peerPool
}
