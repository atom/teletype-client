require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const {startTestServer} = require('@atom/teletype-server')
const setEqual = require('./helpers/set-equal')
const condition = require('./helpers/condition')
const {buildPeerPool, clearPeerPools} = require('./helpers/peer-pools')
const buildStarNetwork = require('./helpers/build-star-network')
const Errors = require('../lib/errors')

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

  teardown(() => {
    clearPeerPools()
  })

  suite('membership', async () => {
    test('joining and leaving', async () => {
      const hubPool = await buildPeerPool('hub', server)
      const spoke1Pool = await buildPeerPool('spoke-1', server)
      const spoke2Pool = await buildPeerPool('spoke-2', server)
      const spoke3Pool = await buildPeerPool('spoke-3', server)

      const hub = buildStarNetwork('network', hubPool, {isHub: true})
      assert(setEqual(hub.getMemberIds(), ['hub']))

      const spoke1 = buildStarNetwork('network', spoke1Pool, {isHub: false})
      assert(setEqual(spoke1.getMemberIds(), ['spoke-1']))

      const spoke2 = buildStarNetwork('network', spoke2Pool, {isHub: false})
      assert(setEqual(spoke2.getMemberIds(), ['spoke-2']))

      const spoke3 = buildStarNetwork('network', spoke3Pool, {isHub: false})
      assert(setEqual(spoke3.getMemberIds(), ['spoke-3']))

      spoke1.connectTo('hub')
      await condition(() => (
        setEqual(hub.getMemberIds(), ['hub', 'spoke-1']) &&
        setEqual(spoke1.getMemberIds(), ['hub', 'spoke-1'])
      ))
      assert.deepEqual(hub.testJoinEvents, ['spoke-1'])
      assert.deepEqual(spoke1.testJoinEvents, [])
      assert.deepEqual(spoke2.testJoinEvents, [])
      assert.deepEqual(spoke3.testJoinEvents, [])

      spoke2.connectTo('hub')
      await condition(() => (
        setEqual(hub.getMemberIds(), ['hub', 'spoke-1', 'spoke-2']) &&
        setEqual(spoke1.getMemberIds(), ['hub', 'spoke-1', 'spoke-2']) &&
        setEqual(spoke2.getMemberIds(), ['hub', 'spoke-1', 'spoke-2'])
      ))
      assert.deepEqual(hub.testJoinEvents, ['spoke-1', 'spoke-2'])
      assert.deepEqual(spoke1.testJoinEvents, ['spoke-2'])
      assert.deepEqual(spoke2.testJoinEvents, [])
      assert.deepEqual(spoke3.testJoinEvents, [])

      spoke3.connectTo('hub')
      await condition(() => (
        setEqual(hub.getMemberIds(), ['hub', 'spoke-1', 'spoke-2', 'spoke-3']) &&
        setEqual(spoke1.getMemberIds(), ['hub', 'spoke-1', 'spoke-2', 'spoke-3']) &&
        setEqual(spoke2.getMemberIds(), ['hub', 'spoke-1', 'spoke-2', 'spoke-3']) &&
        setEqual(spoke3.getMemberIds(), ['hub', 'spoke-1', 'spoke-2', 'spoke-3'])
      ))
      assert.deepEqual(hub.testJoinEvents, ['spoke-1', 'spoke-2', 'spoke-3'])
      assert.deepEqual(spoke1.testJoinEvents, ['spoke-2', 'spoke-3'])
      assert.deepEqual(spoke2.testJoinEvents, ['spoke-3'])
      assert.deepEqual(spoke3.testJoinEvents, [])

      spoke2.disconnect()
      await condition(() => (
        setEqual(hub.getMemberIds(), ['hub', 'spoke-1', 'spoke-3']) &&
        setEqual(spoke1.getMemberIds(), ['hub', 'spoke-1', 'spoke-3']) &&
        setEqual(spoke2.getMemberIds(), ['spoke-2']) &&
        setEqual(spoke3.getMemberIds(), ['hub', 'spoke-1', 'spoke-3'])
      ))
      assert.deepEqual(hub.testLeaveEvents, [{peerId: 'spoke-2', connectionLost: false}])
      assert.deepEqual(spoke1.testLeaveEvents, [{peerId: 'spoke-2', connectionLost: false}])
      assert.deepEqual(spoke2.testLeaveEvents, [])
      assert.deepEqual(spoke3.testLeaveEvents, [{peerId: 'spoke-2', connectionLost: false}])

      hub.disconnect()
      await condition(() => (
        setEqual(hub.getMemberIds(), ['hub']) &&
        setEqual(spoke1.getMemberIds(), ['spoke-1']) &&
        setEqual(spoke2.getMemberIds(), ['spoke-2']) &&
        setEqual(spoke3.getMemberIds(), ['spoke-3'])
      ))
      assert.deepEqual(hub.testLeaveEvents, [{peerId: 'spoke-2', connectionLost: false}])
      assert.deepEqual(spoke1.testLeaveEvents, [
        {peerId: 'spoke-2', connectionLost: false},
        {peerId: 'hub', connectionLost: false}
      ])
      assert.deepEqual(spoke2.testLeaveEvents, [])
      assert.deepEqual(spoke3.testLeaveEvents, [
        {peerId: 'spoke-2', connectionLost: false},
        {peerId: 'hub', connectionLost: false}
      ])
    })

    test('losing connection to peer', async () => {
      const hubPool = await buildPeerPool('hub', server)
      const spoke1Pool = await buildPeerPool('spoke-1', server)
      const spoke2Pool = await buildPeerPool('spoke-2', server)
      const spoke3Pool = await buildPeerPool('spoke-3', server)

      const hub = buildStarNetwork('network', hubPool, {isHub: true})
      const spoke1 = buildStarNetwork('network', spoke1Pool, {isHub: false})
      const spoke2 = buildStarNetwork('network', spoke2Pool, {isHub: false})
      const spoke3 = buildStarNetwork('network', spoke3Pool, {isHub: false})
      await spoke1.connectTo('hub')
      await spoke2.connectTo('hub')
      await spoke3.connectTo('hub')

      spoke1Pool.disconnect()
      await condition(() => (
        setEqual(hub.getMemberIds(), ['hub', 'spoke-2', 'spoke-3']) &&
        setEqual(spoke1.getMemberIds(), ['spoke-1']) &&
        setEqual(spoke2.getMemberIds(), ['hub', 'spoke-2', 'spoke-3']) &&
        setEqual(spoke3.getMemberIds(), ['hub', 'spoke-2', 'spoke-3'])
      ))
      assert.deepEqual(hub.testLeaveEvents, [{peerId: 'spoke-1', connectionLost: true}])
      assert.deepEqual(spoke1.testLeaveEvents, [{peerId: 'hub', connectionLost: true}])
      assert.deepEqual(spoke2.testLeaveEvents, [{peerId: 'spoke-1', connectionLost: true}])
      assert.deepEqual(spoke3.testLeaveEvents, [{peerId: 'spoke-1', connectionLost: true}])

      // Ensure only one leave event is received when disconnecting both the network and the peer pool.
      spoke2.disconnect()
      spoke2Pool.disconnect()

      await condition(() => (
        setEqual(hub.getMemberIds(), ['hub', 'spoke-3']) &&
        setEqual(spoke1.getMemberIds(), ['spoke-1']) &&
        setEqual(spoke2.getMemberIds(), ['spoke-2']) &&
        setEqual(spoke3.getMemberIds(), ['hub', 'spoke-3'])
      ))
      assert.deepEqual(hub.testLeaveEvents, [
        {peerId: 'spoke-1', connectionLost: true},
        {peerId: 'spoke-2', connectionLost: false}
      ])
      assert.deepEqual(spoke1.testLeaveEvents, [{peerId: 'hub', connectionLost: true}])
      assert.deepEqual(spoke2.testLeaveEvents, [{peerId: 'spoke-1', connectionLost: true}])
      assert.deepEqual(spoke3.testLeaveEvents, [
        {peerId: 'spoke-1', connectionLost: true},
        {peerId: 'spoke-2', connectionLost: false}
      ])

      hubPool.disconnect()
      await condition(() => (
        setEqual(hub.getMemberIds(), ['hub']) &&
        setEqual(spoke1.getMemberIds(), ['spoke-1']) &&
        setEqual(spoke2.getMemberIds(), ['spoke-2']) &&
        setEqual(spoke3.getMemberIds(), ['spoke-3'])
      ))
      assert.deepEqual(hub.testLeaveEvents, [
        {peerId: 'spoke-1', connectionLost: true},
        {peerId: 'spoke-2', connectionLost: false},
        {peerId: 'spoke-3', connectionLost: true}
      ])
      assert.deepEqual(spoke1.testLeaveEvents, [{peerId: 'hub', connectionLost: true}])
      assert.deepEqual(spoke2.testLeaveEvents, [{peerId: 'spoke-1', connectionLost: true}])
      assert.deepEqual(spoke3.testLeaveEvents, [
        {peerId: 'spoke-1', connectionLost: true},
        {peerId: 'spoke-2', connectionLost: false},
        {peerId: 'hub', connectionLost: true}
      ])
    })

    test('disconnecting after encountering an error while joining the network', async () => {
      const hubPool = await buildPeerPool('hub', server)
      const spoke1Pool = await buildPeerPool('spoke-1', server)
      const spoke2Pool = await buildPeerPool('spoke-2', server)

      const hub = buildStarNetwork('network', hubPool, {isHub: true})
      const spoke1 = buildStarNetwork('network', spoke1Pool, {isHub: false})
      const spoke2 = buildStarNetwork('network', spoke2Pool, {isHub: false})

      // Prevent spoke-1 from sending connection messages.
      let originalSpoke1PoolSend = spoke1Pool.send
      const peerPoolError = new Error('Cannot send messages')
      spoke1Pool.send = () => { throw peerPoolError }

      let error
      try {
        await spoke1.connectTo('hub')
      } catch (e) {
        error = e
      }
      assert.equal(error, peerPoolError)

      // Re-allow spoke-1 to send messages, and simulate receiving a connection
      // from another spoke. This will ensure that the disconnection of spoke-1
      // is ignored.
      spoke1Pool.send = originalSpoke1PoolSend
      spoke1.disconnect()
      spoke2.connectTo('hub')

      await condition(() => (
        setEqual(hub.getMemberIds(), ['hub', 'spoke-2']) &&
        setEqual(spoke1.getMemberIds(), ['spoke-1']) &&
        setEqual(spoke2.getMemberIds(), ['hub', 'spoke-2'])
      ))

      assert.deepEqual(hub.testJoinEvents, ['spoke-2'])
      assert.deepEqual(spoke1.testJoinEvents, [])
      assert.deepEqual(spoke2.testJoinEvents, [])

      assert.deepEqual(hub.testLeaveEvents, [])
      assert.deepEqual(spoke1.testLeaveEvents, [])
      assert.deepEqual(spoke2.testLeaveEvents, [])
    })

    test('relaying peer identities to spokes', async () => {
      const hubIdentity = {login: 'hub'}
      const spoke1Identity = {login: 'spoke-1'}
      const spoke2Identity = {login: 'spoke-2'}

      server.identityProvider.setIdentitiesByToken({
        'hub-token': hubIdentity,
        'spoke-1-token': spoke1Identity,
        'spoke-2-token': spoke2Identity
      })

      const hubPool = await buildPeerPool('hub', server)
      const spoke1Pool = await buildPeerPool('spoke-1', server)
      const spoke2Pool = await buildPeerPool('spoke-2', server)

      const hub = buildStarNetwork('network', hubPool, {isHub: true})
      const spoke1 = buildStarNetwork('network', spoke1Pool, {isHub: false})
      const spoke2 = buildStarNetwork('network', spoke2Pool, {isHub: false})
      await spoke1.connectTo('hub')
      await spoke2.connectTo('hub')

      await condition(() => (
        setEqual(hub.getMemberIds(), ['hub', 'spoke-1', 'spoke-2']) &&
        setEqual(spoke1.getMemberIds(), ['hub', 'spoke-1', 'spoke-2']) &&
        setEqual(spoke2.getMemberIds(), ['hub', 'spoke-1', 'spoke-2'])
      ))

      assert.equal(hub.getMemberIdentity('hub').login, hubIdentity.login)
      assert.equal(hub.getMemberIdentity('spoke-1').login, spoke1Identity.login)
      assert.equal(hub.getMemberIdentity('spoke-2').login, spoke2Identity.login)

      assert.equal(spoke1.getMemberIdentity('hub').login, hubIdentity.login)
      assert.equal(spoke1.getMemberIdentity('spoke-1').login, spoke1Identity.login)
      assert.equal(spoke1.getMemberIdentity('spoke-2').login, spoke2Identity.login)

      assert.equal(spoke2.getMemberIdentity('hub').login, hubIdentity.login)
      assert.equal(spoke2.getMemberIdentity('spoke-1').login, spoke1Identity.login)
      assert.equal(spoke2.getMemberIdentity('spoke-2').login, spoke2Identity.login)

      // Ensure peer identities can be retrieved on all spokes after disconnection.
      spoke1.disconnect()
      await condition(() => (
        setEqual(hub.getMemberIds(), ['hub', 'spoke-2']) &&
        setEqual(spoke1.getMemberIds(), ['spoke-1']) &&
        setEqual(spoke2.getMemberIds(), ['hub', 'spoke-2'])
      ))

      assert.equal(hub.getMemberIdentity('hub').login, hubIdentity.login)
      assert.equal(hub.getMemberIdentity('spoke-1').login, spoke1Identity.login)
      assert.equal(hub.getMemberIdentity('spoke-2').login, spoke2Identity.login)

      assert.equal(spoke1.getMemberIdentity('hub').login, hubIdentity.login)
      assert.equal(spoke1.getMemberIdentity('spoke-1').login, spoke1Identity.login)
      assert.equal(spoke1.getMemberIdentity('spoke-2').login, spoke2Identity.login)

      assert.equal(spoke2.getMemberIdentity('hub').login, hubIdentity.login)
      assert.equal(spoke2.getMemberIdentity('spoke-1').login, spoke1Identity.login)
      assert.equal(spoke2.getMemberIdentity('spoke-2').login, spoke2Identity.login)
    })
  })

  suite('unicast', () => {
    test('sends messages to only one member of the network', async () => {
      const hubPool = await buildPeerPool('hub', server)
      const spoke1Pool = await buildPeerPool('spoke-1', server)
      const spoke2Pool = await buildPeerPool('spoke-2', server)

      const hub = buildStarNetwork('network-a', hubPool, {isHub: true})
      const spoke1 = buildStarNetwork('network-a', spoke1Pool, {isHub: false})
      const spoke2 = buildStarNetwork('network-a', spoke2Pool, {isHub: false})
      await spoke1.connectTo('hub')
      await spoke2.connectTo('hub')

      spoke1.unicast('spoke-2', 'spoke-to-spoke')
      spoke2.unicast('hub', 'spoke-to-hub')
      hub.unicast('spoke-1', 'hub-to-spoke')

      await condition(() => deepEqual(hub.testInbox, [
        {senderId: 'spoke-2', message: 'spoke-to-hub'}
      ]))
      await condition(() => deepEqual(spoke1.testInbox, [
        {senderId: 'hub', message: 'hub-to-spoke'}
      ]))
      await condition(() => deepEqual(spoke2.testInbox, [
        {senderId: 'spoke-1', message: 'spoke-to-spoke'}
      ]))
    })

    test('sends messages only to peers that are part of the network', async () => {
      const hubPool = await buildPeerPool('hub', server)
      const spoke1Pool = await buildPeerPool('spoke-1', server)
      const spoke2Pool = await buildPeerPool('spoke-2', server)

      const hub = buildStarNetwork('network-a', hubPool, {isHub: true})
      const spoke = buildStarNetwork('network-a', spoke1Pool, {isHub: false})
      await spoke.connectTo('hub')
      await hubPool.connectTo('spoke-2')

      spoke.unicast('spoke-2', 'this should never arrive')
      hubPool.send('spoke-2', 'direct message')
      await condition(() => deepEqual(spoke2Pool.testInbox, [
        {senderId: 'hub', message: 'direct message'}
      ]))
    })
  })

  suite('broadcast', () => {
    test('sends messages to all other members of the network', async () => {
      const peer1Pool = await buildPeerPool('peer-1', server)
      const peer2Pool = await buildPeerPool('peer-2', server)
      const peer3Pool = await buildPeerPool('peer-3', server)
      const peer4Pool = await buildPeerPool('peer-4', server)

      const hubA = buildStarNetwork('network-a', peer1Pool, {isHub: true})
      const spokeA1 = buildStarNetwork('network-a', peer2Pool, {isHub: false})
      const spokeA2 = buildStarNetwork('network-a', peer3Pool, {isHub: false})
      await spokeA1.connectTo('peer-1')
      await spokeA2.connectTo('peer-1')

      const hubB = buildStarNetwork('network-b', peer1Pool, {isHub: true})
      const spokeB1 = buildStarNetwork('network-b', peer2Pool, {isHub: false})
      const spokeB2 = buildStarNetwork('network-b', peer3Pool, {isHub: false})
      await spokeB1.connectTo('peer-1')
      await spokeB2.connectTo('peer-1')

      const hubC = buildStarNetwork('network-c', peer2Pool, {isHub: true})
      const spokeC1 = buildStarNetwork('network-c', peer1Pool, {isHub: false})
      const spokeC2 = buildStarNetwork('network-c', peer3Pool, {isHub: false})
      await spokeC1.connectTo('peer-2')
      await spokeC2.connectTo('peer-2')

      hubA.broadcast('a1')
      spokeA1.broadcast('a2')
      spokeB1.broadcast('b')
      spokeC1.broadcast('c')

      await condition(() => deepEqual(hubA.testInbox, [
        {senderId: 'peer-2', message: 'a2'}
      ]))
      await condition(() => deepEqual(spokeA1.testInbox, [
        {senderId: 'peer-1', message: 'a1'}
      ]))
      await condition(() => deepEqual(spokeA2.testInbox, [
        {senderId: 'peer-1', message: 'a1'},
        {senderId: 'peer-2', message: 'a2'}
      ]))

      await condition(() => deepEqual(hubB.testInbox, [
        {senderId: 'peer-2', message: 'b'}
      ]))
      await condition(() => deepEqual(spokeB2.testInbox, [
        {senderId: 'peer-2', message: 'b'}
      ]))

      await condition(() => deepEqual(hubC.testInbox, [
        {senderId: 'peer-1', message: 'c'}
      ]))
      await condition(() => deepEqual(spokeC2.testInbox, [
        {senderId: 'peer-1', message: 'c'}
      ]))
    })

    test('sends messages only to peers that are part of the network', async () => {
      const hubPool = await buildPeerPool('hub', server)
      const spoke1Pool = await buildPeerPool('spoke-1', server)
      const spoke2Pool = await buildPeerPool('spoke-2', server)
      const nonMemberPool = await buildPeerPool('non-member', server)

      const hub = buildStarNetwork('some-network-id', hubPool, {isHub: true})
      const spoke1 = buildStarNetwork('some-network-id', spoke1Pool, {isHub: false})
      const spoke2 = buildStarNetwork('some-network-id', spoke2Pool, {isHub: false})
      await spoke1.connectTo('hub')
      await spoke2.connectTo('hub')
      await nonMemberPool.connectTo('hub')

      // Clear peer pool inboxes to delete initial handshake messages.
      hubPool.testInbox = []
      spoke1Pool.testInbox = []
      spoke2Pool.testInbox = []
      nonMemberPool.testInbox = []

      spoke1.broadcast('hello')
      await condition(() => deepEqual(hub.testInbox, [{
        senderId: 'spoke-1',
        message: 'hello'
      }]))
      await condition(() => deepEqual(spoke2.testInbox, [{
        senderId: 'spoke-1',
        message: 'hello'
      }]))

      // Ensure that spoke1 did not receive their own broadcast
      hubPool.send('spoke-1', 'direct message')
      await condition(() => deepEqual(spoke1Pool.testInbox, [
        {senderId: 'hub', message: 'direct message'}
      ]))

      // Ensure that peer 4 did not receive the broadcast since they are
      // not a member of the network
      hubPool.send('non-member', 'direct message')
      await condition(() => deepEqual(nonMemberPool.testInbox, [
        {senderId: 'hub', message: 'direct message'}
      ]))
    })
  })

  test('throws when connecting to a network exceeds the connection timeout', async () => {
    const hubPool = await buildPeerPool('hub', server)
    const spoke1Pool = await buildPeerPool('spoke-1', server)
    const hub = buildStarNetwork('network', hubPool, {isHub: true, connectionTimeout: 1000})
    const spoke1 = buildStarNetwork('network', spoke1Pool, {isHub: false, connectionTimeout: 1})

    let error
    try {
      await spoke1.connectTo('hub')
    } catch (e) {
      error = e
    }
    assert(error instanceof Errors.NetworkConnectionError)

    // The spoke that timed out may be able to connect to the hub eventually.
    // Here we simulate receiving a connection from another spoke, ensuring that
    // the spoke that timed out is not included in the members list.
    const spoke2Pool = await buildPeerPool('spoke-2', server)
    const spoke2 = buildStarNetwork('network', spoke2Pool, {isHub: false, connectionTimeout: 1000})
    await spoke2.connectTo('hub')
    assert(setEqual(hub.getMemberIds(), ['hub', 'spoke-2']))
    assert(setEqual(spoke1.getMemberIds(), ['spoke-1']))
    assert(setEqual(spoke2.getMemberIds(), ['hub', 'spoke-2']))
  })
})
