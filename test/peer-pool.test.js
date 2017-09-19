require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const {startTestServer} = require('@atom/real-time-server')
const condition = require('./helpers/condition')
const RestGateway = require('../lib/rest-gateway')
const Errors = require('../lib/errors')
const PeerPool = require('../lib/peer-pool')
const {buildPeerPool, clearPeerPools} = require('./helpers/peer-pools')

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

  teardown(() => {
    clearPeerPools()
  })

  test('connection and sending messages between peers', async () => {
    const peer1Pool = await buildPeerPool('1', server)
    const peer2Pool = await buildPeerPool('2', server)
    const peer3Pool = await buildPeerPool('3', server)

    // Connection
    await peer1Pool.connectTo('3')
    await peer2Pool.connectTo('3')

    await peer1Pool.getConnectedPromise('3')
    await peer2Pool.getConnectedPromise('3')
    await peer3Pool.getConnectedPromise('1')
    await peer3Pool.getConnectedPromise('2')

    // Single-part messages
    peer1Pool.send('3', Buffer.from('a'))
    peer2Pool.send('3', Buffer.from('b'))

    await condition(() => {
      peer3Pool.testInbox.sort((a, b) => a.senderId.localeCompare(b.senderId))
      return deepEqual(peer3Pool.testInbox, [
        {senderId: '1', message: 'a'},
        {senderId: '2', message: 'b'}
      ])
    })
    peer3Pool.testInbox.length = 0

    // Multi-part messages
    const longMessage = 'x'.repeat(22)
    peer1Pool.send('3', Buffer.from(longMessage))
    await condition(() => deepEqual(peer3Pool.testInbox, [{senderId: '1', message: longMessage}]))
    peer3Pool.testInbox.length = 0

    // Disconnection
    peer2Pool.disconnect()
    await peer2Pool.getDisconnectedPromise('3')
    await peer3Pool.getDisconnectedPromise('2')
    assert.deepEqual(peer1Pool.testDisconnectionEvents, [])
    assert.deepEqual(peer2Pool.testDisconnectionEvents, ['3'])
    assert.deepEqual(peer3Pool.testDisconnectionEvents, ['2'])

    peer3Pool.disconnect()
    await peer1Pool.getDisconnectedPromise('3')
    await peer3Pool.getDisconnectedPromise('1')
    assert.deepEqual(peer1Pool.testDisconnectionEvents, ['3'])
    assert.deepEqual(peer2Pool.testDisconnectionEvents, ['3'])
    assert.deepEqual(peer3Pool.testDisconnectionEvents, ['2', '1'])
  })

  test('waiting too long to establish a connection to the pub-sub service', async () => {
    const restGateway = new RestGateway({baseURL: server.address})
    const subscription = {
      disposed: false,
      dispose () {
        this.disposed = true
      }
    }
    const pubSubGateway = {
      subscribe () {
        return new Promise((resolve) => setTimeout(() => { resolve(subscription) }, 150))
      }
    }
    const peerPool = new PeerPool({peerId: '1', timeoutInMilliseconds: 100, restGateway, pubSubGateway})

    let error
    try {
      await peerPool.initialize()
    } catch (e) {
      error = e
    }
    assert(error instanceof Errors.PubSubConnectionError)

    // Ensure the subscription gets disposed when its promise finally resolves.
    await condition(() => subscription.disposed)
  })

  test('waiting too long to establish a connection to another peer', async () => {
    const restGateway = new RestGateway({baseURL: server.address})
    const subscribeRequests = []
    const pubSubGateway = {
      subscribe () {
        subscribeRequests.push(arguments)
        return Promise.resolve()
      }
    }
    const peer1Pool = new PeerPool({peerId: '1', timeoutInMilliseconds: 100, restGateway, pubSubGateway})
    const peer2Pool = new PeerPool({peerId: '2', timeoutInMilliseconds: 100, restGateway, pubSubGateway})
    await Promise.all([peer1Pool.initialize(), peer2Pool.initialize()])

    let error
    try {
      await peer1Pool.connectTo('2')
    } catch (e) {
      error = e
    }
    assert(error instanceof Errors.PeerConnectionError)

    // Ensure the connection can be established later if the error resolves
    // itself. To do so, we will forward all the subscribe requests received so
    // far to the server's pub sub gateway, so that the two peers can
    // communicate with each other.
    for (const subscribeRequest of subscribeRequests) {
      server.pubSubGateway.subscribe(...subscribeRequest)
    }
    peer1Pool.timeoutInMilliseconds = 2000
    peer2Pool.timeoutInMilliseconds = 2000

    await peer1Pool.connectTo('2')
    await peer1Pool.getConnectedPromise('2')
    await peer2Pool.getConnectedPromise('1')
  })
})
