require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const PeerPool = require('../lib/peer-pool')
const {startTestServer} = require('@atom/real-time-server')

suite('PeerPool', () => {
  let server

  suiteSetup(async () => {
    server = await startTestServer()
  })

  suiteTeardown(() => {
    return server.stop()
  })

  setup(() => {
    return server.reset()
  })

  test('connection and sending messages between peers', async () => {
    const peer1Pool = await buildPeerPool('1', server)
    const peer2Pool = await buildPeerPool('2', server)
    const peer3Pool = await buildPeerPool('3', server)

    // Connection
    await peer1Pool.connectTo('3')
    await peer2Pool.connectTo('3')
    await condition(() => peer3Pool.isConnectedToPeer('1') && peer3Pool.isConnectedToPeer('2'))

    const peer3Inbox = []
    peer3Pool.onReceive(({senderId, message}) => {
      peer3Inbox.push({senderId, message: message.toString()})
      peer3Inbox.sort((a, b) => a.senderId.localeCompare(b.peerId))
    })

    // Single-part messages
    peer1Pool.send('3', Buffer.from('a'))
    peer2Pool.send('3', Buffer.from('b'))

    await condition(() => deepEqual(peer3Inbox, [
      {senderId: '1', message: 'a'},
      {senderId: '2', message: 'b'}
    ]))
    peer3Inbox.length = 0

    // Multi-part messages
    const longMessage = 'x'.repeat(22)
    peer1Pool.send('3', Buffer.from(longMessage))
    await condition(() => deepEqual(peer3Inbox, [{senderId: '1', message: longMessage}]))
    peer3Inbox.length = 0
  })
})

async function buildPeerPool (peerId, server) {
  const peerPool = new PeerPool({
    peerId,
    restGateway: server.restGateway,
    pubSubGateway: server.pubSubGateway,
  })
  await peerPool.subscribe()
  return peerPool
}

function condition (fn) {
  return new Promise((resolve) => {
    const intervalId = setInterval(() => {
      if (fn()) {
        clearInterval(intervalId)
        resolve()
      }
    }, 5)
  })
}
