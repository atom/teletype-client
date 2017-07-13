const PeerPool = require('../../lib/peer-pool')

module.exports =
async function buildPeerPool (peerId, server) {
  const peerPool = new PeerPool({
    peerId,
    restGateway: server.restGateway,
    pubSubGateway: server.pubSubGateway,
  })
  await peerPool.subscribe()
  peerPool.testInbox = []
  peerPool.onReceive(({senderId, message}) => {
    peerPool.testInbox.push({
      senderId,
      message: message.toString()
    })
  })
  return peerPool
}
