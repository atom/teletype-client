require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const {startTestServer} = require('@atom/teletype-server')
const condition = require('./helpers/condition')
const RestGateway = require('../lib/rest-gateway')
const Errors = require('../lib/errors')
const PeerPool = require('../lib/peer-pool')
const {buildPeerPool, clearPeerPools} = require('./helpers/peer-pools')
const {Disposable} = require('event-kit')

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

    // Local peer identities
    assert.equal(peer1Pool.getLocalPeerIdentity().login, 'user-with-token-1-token')
    assert.equal(peer2Pool.getLocalPeerIdentity().login, 'user-with-token-2-token')
    assert.equal(peer3Pool.getLocalPeerIdentity().login, 'user-with-token-3-token')

    // Connection
    await peer1Pool.connectTo('3')
    await peer2Pool.connectTo('3')

    await peer1Pool.getConnectedPromise('3')
    await peer2Pool.getConnectedPromise('3')
    await peer3Pool.getConnectedPromise('1')
    await peer3Pool.getConnectedPromise('2')

    // Remote peer identities
    assert.equal(peer1Pool.getPeerIdentity('3').login, 'user-with-token-3-token')
    assert.equal(peer3Pool.getPeerIdentity('1').login, 'user-with-token-1-token')
    assert.equal(peer2Pool.getPeerIdentity('3').login, 'user-with-token-3-token')
    assert.equal(peer3Pool.getPeerIdentity('2').login, 'user-with-token-2-token')

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

    // Retain local peer identities after disconnecting
    assert.equal(peer1Pool.getLocalPeerIdentity().login, 'user-with-token-1-token')
    assert.equal(peer2Pool.getLocalPeerIdentity().login, 'user-with-token-2-token')
    assert.equal(peer3Pool.getLocalPeerIdentity().login, 'user-with-token-3-token')

    // Retain remote peer identities after disconnecting
    assert.equal(peer1Pool.getPeerIdentity('3').login, 'user-with-token-3-token')
    assert.equal(peer3Pool.getPeerIdentity('1').login, 'user-with-token-1-token')
    assert.equal(peer2Pool.getPeerIdentity('3').login, 'user-with-token-3-token')
    assert.equal(peer3Pool.getPeerIdentity('2').login, 'user-with-token-2-token')
  })

  test('timeouts connecting to the pub-sub service', async () => {
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
    const peerPool = new PeerPool({peerId: '1', connectionTimeout: 100, restGateway, pubSubGateway})
    await peerPool.initialize()

    let error
    try {
      await peerPool.listen()
    } catch (e) {
      error = e
    }
    assert(error instanceof Errors.PubSubConnectionError)

    // Ensure the subscription gets disposed when its promise finally resolves.
    await condition(() => subscription.disposed)
  })

  test('authentication errors during signaling', async () => {
    const peer1Pool = await buildPeerPool('1', server, {connectionTimeout: 300})
    const peer2Pool = await buildPeerPool('2', server)

    // Simulate peer 2 revoking their access token after initializing
    server.identityProvider.setIdentitiesByToken({
      '1-token': {login: 'peer-1'},
      '2-token': null,
    })

    // Invalid token error during offer phase of signaling
    {
      let error
      try {
        await peer2Pool.connectTo('1')
      } catch (e) {
        error = e
      }
      assert(error instanceof Errors.InvalidAuthenticationTokenError)
    }

    // Invalid token error during answer phase of signaling
    {
      let error
      try {
        await peer1Pool.connectTo('2')
      } catch (e) {
        error = e
      }
      assert(error instanceof Errors.PeerConnectionError)
      assert(peer2Pool.testErrors.length > 0)
      assert(peer2Pool.testErrors.every((e) => e instanceof Errors.InvalidAuthenticationTokenError))
    }

    // After restoring peer 2's identity, we should be able to connect
    server.identityProvider.setIdentitiesByToken({
      '1-token': {login: 'peer-1'},
      '2-token': {login: 'peer-2'},
    })
    await peer1Pool.connectTo('2')
  })

  test('timeouts establishing a connection to a peer', async () => {
    const restGateway = new RestGateway({baseURL: server.address})
    const subscribeRequests = []
    const pubSubGateway = {
      subscribe () {
        subscribeRequests.push(arguments)
        return Promise.resolve({
          dispose () {}
        })
      }
    }

    const peer1Pool = new PeerPool({peerId: '1', connectionTimeout: 100, restGateway, pubSubGateway})
    const peer2Pool = new PeerPool({peerId: '2', connectionTimeout: 100, restGateway, pubSubGateway})
    await Promise.all([peer1Pool.initialize(), peer2Pool.initialize()])
    await Promise.all([peer1Pool.listen(), peer2Pool.listen()])

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
    peer1Pool.connectionTimeout = 2000
    peer2Pool.connectionTimeout = 2000

    await peer1Pool.connectTo('2')
    await peer1Pool.getConnectedPromise('2')
    await peer2Pool.getConnectedPromise('1')
  })

  test('attempting to connect to yourself', async () => {
    const peerPool = await buildPeerPool('1', server)

    let error
    try {
      await peerPool.connectTo('1')
    } catch (e) {
      error = e
    }
    assert(error instanceof Errors.PeerConnectionError)
  })

  test('RTCPeerConnection and RTCDataChannel error events', async () => {
    const peer1Pool = await buildPeerPool('1', server)
    const peer2Pool = await buildPeerPool('2', server)
    const peer3Pool = await buildPeerPool('3', server)
    const peer4Pool = await buildPeerPool('4', server)
    await peer1Pool.connectTo('2')
    await peer1Pool.connectTo('3')
    await peer1Pool.connectTo('4')
    const peer2Connection = peer1Pool.getPeerConnection('2')
    const peer3Connection = peer1Pool.getPeerConnection('3')
    const peer4Connection = peer1Pool.getPeerConnection('4')

    const errorEvent1 = new ErrorEvent('')
    peer2Connection.rtcPeerConnection.onerror(errorEvent1)
    assert.deepEqual(peer1Pool.testErrors, [errorEvent1])
    assert.deepEqual(peer1Pool.testDisconnectionEvents, ['2'])
    assert.notEqual(peer1Pool.getPeerConnection('2'), peer2Connection)

    const errorEvent2 = new ErrorEvent('')
    peer3Connection.rtcPeerConnection.onerror(errorEvent2)
    assert.deepEqual(peer1Pool.testDisconnectionEvents, ['2', '3'])
    assert.deepEqual(peer1Pool.testErrors, [errorEvent1, errorEvent2])
    assert.notEqual(peer1Pool.getPeerConnection('3'), peer3Connection)

    const errorEvent3 = new ErrorEvent('')
    peer4Connection.channel.onerror(errorEvent3)
    assert.deepEqual(peer1Pool.testDisconnectionEvents, ['2', '3', '4'])
    assert.deepEqual(peer1Pool.testErrors, [errorEvent1, errorEvent2, errorEvent3])
    assert.notEqual(peer1Pool.getPeerConnection('4'), peer4Connection)
  })

  test('listening more than once for incoming connections', async () => {
    const peerPool = await buildPeerPool('1', server, {listen: false})
    peerPool.pubSubGateway = {
      subscriptionsCount: 0,
      subscribe () {
        this.subscriptionsCount++
        return new Disposable(() => this.subscriptionsCount--)
      }
    }

    // Parallel calls to `listen` will only subscribe once.
    const [listen1Disposable, listen2Disposable] = await Promise.all([peerPool.listen(), peerPool.listen()])
    const listen3Disposable = await peerPool.listen()
    assert.equal(peerPool.pubSubGateway.subscriptionsCount, 1)

    // Dispose subscription when the last listener is disposed.
    listen1Disposable.dispose()
    assert.equal(peerPool.pubSubGateway.subscriptionsCount, 1)

    listen2Disposable.dispose()
    assert.equal(peerPool.pubSubGateway.subscriptionsCount, 1)

    listen3Disposable.dispose()
    assert.equal(peerPool.pubSubGateway.subscriptionsCount, 0)

    // Ensure PeerPool can listen again.
    const listen4Disposable = await peerPool.listen()
    assert.equal(peerPool.pubSubGateway.subscriptionsCount, 1)

    // Ensure disposing the PeerPool also disposes subscriptions.
    peerPool.dispose()
    assert.equal(peerPool.pubSubGateway.subscriptionsCount, 0)
  })
})
