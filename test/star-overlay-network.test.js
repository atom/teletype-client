require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const {startTestServer} = require('@atom/real-time-server')
const PeerPool = require('../lib/peer-pool')
const StarOverlayNetwork = require('../lib/star-overlay-network')

suite('StarOverlayNetwork', () => {
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

  test('broadcasts are sent only to peers that are part of the network', async () => {
    const peer1Pool = await buildPeerPool('peer-1', server)
    const peer2Pool = await buildPeerPool('peer-2', server)
    const peer3Pool = await buildPeerPool('peer-3', server)
    const peer4Pool = await buildPeerPool('peer-4', server)

    const hub = buildNetwork('network-1', peer1Pool, true)
    const spoke1 = buildNetwork('network-1', peer2Pool, false)
    const spoke2 = buildNetwork('network-1', peer3Pool, false)
    await spoke1.connectTo('peer-1')
    await spoke2.connectTo('peer-1')

    await peer4Pool.connectTo('peer-1')

    spoke1.broadcast(Buffer.from('hello'))
    await condition(() => deepEqual(hub.testInbox, [{
      senderId: 'peer-2',
      message: 'hello'
    }]))
    await condition(() => deepEqual(spoke2.testInbox, [{
      senderId: 'peer-2',
      message: 'hello'
    }]))

    // Ensure that spoke1 did not receive their own broadcast
    peer1Pool.send('peer-2', Buffer.from('direct message'))
    await condition(() => deepEqual(peer2Pool.testInbox, [
      {senderId: 'peer-1', message: 'direct message'}
    ]))

    // Ensure that peer 4 did not receive the broadcast since they are
    // not a member of the network
    peer1Pool.send('peer-4', Buffer.from('direct message'))
    await condition(() => deepEqual(peer4Pool.testInbox, [
      {senderId: 'peer-1', message: 'direct message'}
    ]))
  })

})

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

function buildNetwork (id, peerPool, isHub) {
  const network = new StarOverlayNetwork({id, peerPool, isHub})
  network.testInbox = []
  network.onReceive(({senderId, message}) => {
    network.testInbox.push({
      senderId,
      message: message.toString()
    })
  })
  return network
}

function condition (fn) {
  const timeoutError = new Error('Condition timed out: ' + fn.toString())
  Error.captureStackTrace(timeoutError, condition)

  return new Promise((resolve, reject) => {
    const intervalId = global.setInterval(() => {
      if (fn()) {
        global.clearTimeout(timeout)
        global.clearInterval(intervalId)
        resolve()
      }
    }, 5)

    const timeout = global.setTimeout(() => {
      global.clearInterval(intervalId)
      reject(timeoutError)
    }, 500)
  })
}
