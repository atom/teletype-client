require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const {startTestServer} = require('@atom/real-time-server')
const setEqual = require('./helpers/set-equal')
const condition = require('./helpers/condition')
const buildPeerPool = require('./helpers/build-peer-pool')
const buildStarNetwork = require('./helpers/build-star-network')

suite('StarOverlayNetwork', () => {
  let server

  suiteSetup(async () => {
    server = await startTestServer()
  })

  suiteTeardown(() => {
    return server.stop()
  })

  setup(() => {
    server.identityProvider.setUsersByOauthToken({
      'some-token': {username: 'some-user'},
    })

    return server.reset()
  })

  suite('membership', async () => {
    let hubPool, spoke1Pool, spoke2Pool, spoke3Pool, members

    setup(async () => {
      server.identityProvider.setUsersByOauthToken({
        'hub-token': {username: 'hub-user'},
        'spoke-1-token': {username: 'spoke-1-user'},
        'spoke-2-token': {username: 'spoke-2-user'},
        'spoke-3-token': {username: 'spoke-3-user'}
      })

      hubPool = await buildPeerPool('hub', 'hub-token', server)
      spoke1Pool = await buildPeerPool('spoke-1', 'spoke-1-token', server)
      spoke2Pool = await buildPeerPool('spoke-2', 'spoke-2-token', server)
      spoke3Pool = await buildPeerPool('spoke-3', 'spoke-3-token', server)

      members = {
        'hub': {peerId: 'hub', username: 'hub-user'},
        'spoke1': {peerId: 'spoke-1', username: 'spoke-1-user'},
        'spoke2': {peerId: 'spoke-2', username: 'spoke-2-user'},
        'spoke3': {peerId: 'spoke-3', username: 'spoke-3-user'}
      }
    })

    test('joining and leaving', async () => {
      const hub = buildStarNetwork('network', hubPool, true)
      assert(hasSameMembers(hub.getMembers(), [members.hub]))

      const spoke1 = buildStarNetwork('network', spoke1Pool, false)
      assert(hasSameMembers(spoke1.getMembers(), [members.spoke1]))

      const spoke2 = buildStarNetwork('network', spoke2Pool, false)
      assert(hasSameMembers(spoke2.getMembers(), [members.spoke2]))

      const spoke3 = buildStarNetwork('network', spoke3Pool, false)
      assert(hasSameMembers(spoke3.getMembers(), [members.spoke3]))

      spoke1.connectTo('hub')
      await condition(() => (
        hasSameMembers(hub.getMembers(), [members.hub, members.spoke1]) &&
        hasSameMembers(spoke1.getMembers(), [members.hub, members.spoke1])
      ))
      assert.deepEqual(hub.testJoinEvents, ['spoke-1'])
      assert.deepEqual(spoke1.testJoinEvents, [])
      assert.deepEqual(spoke2.testJoinEvents, [])
      assert.deepEqual(spoke3.testJoinEvents, [])

      spoke2.connectTo('hub')
      await condition(() => (
        hasSameMembers(hub.getMembers(), [members.hub, members.spoke1, members.spoke2]) &&
        hasSameMembers(spoke1.getMembers(), [members.hub, members.spoke1, members.spoke2]) &&
        hasSameMembers(spoke2.getMembers(), [members.hub, members.spoke1, members.spoke2])
      ))
      assert.deepEqual(hub.testJoinEvents, ['spoke-1', 'spoke-2'])
      assert.deepEqual(spoke1.testJoinEvents, ['spoke-2'])
      assert.deepEqual(spoke2.testJoinEvents, [])
      assert.deepEqual(spoke3.testJoinEvents, [])

      spoke3.connectTo('hub')
      await condition(() => (
        hasSameMembers(hub.getMembers(), [members.hub, members.spoke1, members.spoke2, members.spoke3]) &&
        hasSameMembers(spoke1.getMembers(), [members.hub, members.spoke1, members.spoke2, members.spoke3]) &&
        hasSameMembers(spoke2.getMembers(), [members.hub, members.spoke1, members.spoke2, members.spoke3]) &&
        hasSameMembers(spoke3.getMembers(), [members.hub, members.spoke1, members.spoke2, members.spoke3])
      ))
      assert.deepEqual(hub.testJoinEvents, ['spoke-1', 'spoke-2', 'spoke-3'])
      assert.deepEqual(spoke1.testJoinEvents, ['spoke-2', 'spoke-3'])
      assert.deepEqual(spoke2.testJoinEvents, ['spoke-3'])
      assert.deepEqual(spoke3.testJoinEvents, [])

      spoke2.disconnect()
      await condition(() => (
        hasSameMembers(hub.getMembers(), [members.hub, members.spoke1, members.spoke3]) &&
        hasSameMembers(spoke1.getMembers(), [members.hub, members.spoke1, members.spoke3]) &&
        hasSameMembers(spoke2.getMembers(), [members.spoke2]) &&
        hasSameMembers(spoke3.getMembers(), [members.hub, members.spoke1, members.spoke3])
      ))
      assert.deepEqual(hub.testLeaveEvents, [{peerId: 'spoke-2', connectionLost: false}])
      assert.deepEqual(spoke1.testLeaveEvents, [{peerId: 'spoke-2', connectionLost: false}])
      assert.deepEqual(spoke2.testLeaveEvents, [])
      assert.deepEqual(spoke3.testLeaveEvents, [{peerId: 'spoke-2', connectionLost: false}])

      hub.disconnect()
      await condition(() => (
        hasSameMembers(hub.getMembers(), [members.hub]) &&
        hasSameMembers(spoke1.getMembers(), [members.spoke1]) &&
        hasSameMembers(spoke2.getMembers(), [members.spoke2]) &&
        hasSameMembers(spoke3.getMembers(), [members.spoke3])
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
      const hub = buildStarNetwork('network', hubPool, true)
      const spoke1 = buildStarNetwork('network', spoke1Pool, false)
      const spoke2 = buildStarNetwork('network', spoke2Pool, false)
      const spoke3 = buildStarNetwork('network', spoke3Pool, false)
      await spoke1.connectTo('hub')
      await spoke2.connectTo('hub')
      await spoke3.connectTo('hub')

      spoke1Pool.disconnect()
      await condition(() => (
        hasSameMembers(hub.getMembers(), [members.hub, members.spoke2, members.spoke3]) &&
        hasSameMembers(spoke1.getMembers(), [members.spoke1]) &&
        hasSameMembers(spoke2.getMembers(), [members.hub, members.spoke2, members.spoke3]) &&
        hasSameMembers(spoke3.getMembers(), [members.hub, members.spoke2, members.spoke3])
      ))
      assert.deepEqual(hub.testLeaveEvents, [{peerId: 'spoke-1', connectionLost: true}])
      assert.deepEqual(spoke1.testLeaveEvents, [{peerId: 'hub', connectionLost: true}])
      assert.deepEqual(spoke2.testLeaveEvents, [{peerId: 'spoke-1', connectionLost: true}])
      assert.deepEqual(spoke3.testLeaveEvents, [{peerId: 'spoke-1', connectionLost: true}])

      hubPool.disconnect()
      await condition(() => (
        hasSameMembers(hub.getMembers(), [members.hub]) &&
        hasSameMembers(spoke1.getMembers(), [members.spoke1]) &&
        hasSameMembers(spoke2.getMembers(), [members.spoke2]) &&
        hasSameMembers(spoke3.getMembers(), [members.spoke3])
      ))
      assert.deepEqual(hub.testLeaveEvents, [
        {peerId: 'spoke-1', connectionLost: true},
        {peerId: 'spoke-2', connectionLost: true},
        {peerId: 'spoke-3', connectionLost: true}
      ])
      assert.deepEqual(spoke1.testLeaveEvents, [{peerId: 'hub', connectionLost: true}])
      assert.deepEqual(spoke2.testLeaveEvents, [
        {peerId: 'spoke-1', connectionLost: true},
        {peerId: 'hub', connectionLost: true}
      ])
      assert.deepEqual(spoke3.testLeaveEvents, [
        {peerId: 'spoke-1', connectionLost: true},
        {peerId: 'spoke-2', connectionLost: true},
        {peerId: 'hub', connectionLost: true}
      ])
    })
  })

  suite('unicast', () => {
    test('sends messages to only one member of the network', async () => {
      const hubPool = await buildPeerPool('hub', 'some-token', server)
      const spoke1Pool = await buildPeerPool('spoke-1', 'some-token', server)
      const spoke2Pool = await buildPeerPool('spoke-2', 'some-token', server)

      const hub = buildStarNetwork('network-a', hubPool, true)
      const spoke1 = buildStarNetwork('network-a', spoke1Pool, false)
      const spoke2 = buildStarNetwork('network-a', spoke2Pool, false)
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
      const hubPool = await buildPeerPool('hub', 'some-token', server)
      const spoke1Pool = await buildPeerPool('spoke-1', 'some-token', server)
      const spoke2Pool = await buildPeerPool('spoke-2', 'some-token', server)

      const hub = buildStarNetwork('network-a', hubPool, true)
      const spoke = buildStarNetwork('network-a', spoke1Pool, false)
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
      const peer1Pool = await buildPeerPool('peer-1', 'some-token', server)
      const peer2Pool = await buildPeerPool('peer-2', 'some-token', server)
      const peer3Pool = await buildPeerPool('peer-3', 'some-token', server)
      const peer4Pool = await buildPeerPool('peer-4', 'some-token', server)

      const hubA = buildStarNetwork('network-a', peer1Pool, true)
      const spokeA1 = buildStarNetwork('network-a', peer2Pool, false)
      const spokeA2 = buildStarNetwork('network-a', peer3Pool, false)
      await spokeA1.connectTo('peer-1')
      await spokeA2.connectTo('peer-1')

      const hubB = buildStarNetwork('network-b', peer1Pool, true)
      const spokeB1 = buildStarNetwork('network-b', peer2Pool, false)
      const spokeB2 = buildStarNetwork('network-b', peer3Pool, false)
      await spokeB1.connectTo('peer-1')
      await spokeB2.connectTo('peer-1')

      const hubC = buildStarNetwork('network-c', peer2Pool, true)
      const spokeC1 = buildStarNetwork('network-c', peer1Pool, false)
      const spokeC2 = buildStarNetwork('network-c', peer3Pool, false)
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
      const hubPool = await buildPeerPool('hub', 'some-token', server)
      const spoke1Pool = await buildPeerPool('spoke-1', 'some-token', server)
      const spoke2Pool = await buildPeerPool('spoke-2', 'some-token', server)
      const nonMemberPool = await buildPeerPool('non-member', 'some-token', server)

      const hub = buildStarNetwork('some-network-id', hubPool, true)
      const spoke1 = buildStarNetwork('some-network-id', spoke1Pool, false)
      const spoke2 = buildStarNetwork('some-network-id', spoke2Pool, false)
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
})

function hasSameMembers (actual, expected) {
  actual = Array.from(actual)
  expected = Array.from(expected)

  if (actual.length !== expected.length) return false

  for (let i = 0; i < actual.length; i++) {
    const matchingMembers = expected.filter((m) => deepEqual(actual[i], m))
    if (matchingMembers.length !== 1) return false
  }

  return true
}
