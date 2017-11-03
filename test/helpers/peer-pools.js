const PeerPool = require('../../lib/peer-pool')
const RestGateway = require('../../lib/rest-gateway')

let testEpoch = 0
const peerPools = []

exports.buildPeerPool =
async function buildPeerPool (peerId, server, options = {}) {
  const oauthToken = peerId + '-token'
  const peerPool = new PeerPool({
    peerId,
    peerIdentity: await server.identityProvider.identityForToken(oauthToken),
    restGateway: new RestGateway({baseURL: server.address, oauthToken}),
    pubSubGateway: server.pubSubGateway,
    connectionTimeout: options.connectionTimeout,
    testEpoch
  })
  await peerPool.initialize()
  if (options.listen !== false) await peerPool.listen()

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

  peerPool.testErrors = []
  peerPool.onError((error) => {
    peerPool.testErrors.push(error)
  })

  peerPools.push(peerPool)

  return peerPool
}

exports.clearPeerPools =
function clearPeerPools () {
  for (const peerPool of peerPools) {
    peerPool.dispose()
  }
  peerPools.length = 0
  testEpoch++
}
