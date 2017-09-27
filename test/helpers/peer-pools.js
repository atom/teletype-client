const PeerPool = require('../../lib/peer-pool')
const RestGateway = require('../../lib/rest-gateway')

let testEpoch = 0
const peerPools = []

exports.buildPeerPool =
async function buildPeerPool (peerId, server, options = {}) {
  const peerPool = new PeerPool({
    peerId,
    restGateway: new RestGateway({baseURL: server.address}),
    pubSubGateway: server.pubSubGateway,
    connectionTimeout: options.connectionTimeout,
    testEpoch,
    authTokenProvider: {
      forgotTokenCount: 0,
      getToken () {
        return Promise.resolve(peerId + '-token')
      },
      forgetToken () {
        this.forgotTokenCount++
      }
    }
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
    peerPool.disconnect()
  }
  peerPools.length = 0
  testEpoch++
}
