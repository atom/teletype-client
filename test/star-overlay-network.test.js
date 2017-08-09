require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const {startTestServer} = require('@atom/real-time-server')
const setEqual = require('./helpers/set-equal')
const condition = require('./helpers/condition')
const buildPeerPool = require('./helpers/build-peer-pool')
const buildStarNetwork = require('./helpers/build-star-network')
const getExampleMediaStream = require('./helpers/get-example-media-stream')

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

  suite('membership', async () => {
    test('joining and leaving', async () => {
      const hubPool = await buildPeerPool('hub', server)
      const spoke1Pool = await buildPeerPool('spoke-1', server)
      const spoke2Pool = await buildPeerPool('spoke-2', server)
      const spoke3Pool = await buildPeerPool('spoke-3', server)

      const hub = buildStarNetwork('network', hubPool, true)
      assert.deepEqual(hub.getMembers(), new Set(['hub']))

      const spoke1 = buildStarNetwork('network', spoke1Pool, false)
      assert.deepEqual(spoke1.getMembers(), new Set(['spoke-1']))

      const spoke2 = buildStarNetwork('network', spoke2Pool, false)
      assert.deepEqual(spoke2.getMembers(), new Set(['spoke-2']))

      const spoke3 = buildStarNetwork('network', spoke3Pool, false)
      assert.deepEqual(spoke3.getMembers(), new Set(['spoke-3']))

      spoke1.connectTo('hub')
      await condition(() => (
        setEqual(hub.getMembers(), ['hub', 'spoke-1']) &&
        setEqual(spoke1.getMembers(), ['hub', 'spoke-1'])
      ))
      assert.deepEqual(hub.testJoinEvents, ['spoke-1'])
      assert.deepEqual(spoke1.testJoinEvents, [])
      assert.deepEqual(spoke2.testJoinEvents, [])
      assert.deepEqual(spoke3.testJoinEvents, [])

      spoke2.connectTo('hub')
      await condition(() => (
        setEqual(hub.getMembers(), ['hub', 'spoke-1', 'spoke-2']) &&
        setEqual(spoke1.getMembers(), ['hub', 'spoke-1', 'spoke-2']) &&
        setEqual(spoke2.getMembers(), ['hub', 'spoke-1', 'spoke-2'])
      ))
      assert.deepEqual(hub.testJoinEvents, ['spoke-1', 'spoke-2'])
      assert.deepEqual(spoke1.testJoinEvents, ['spoke-2'])
      assert.deepEqual(spoke2.testJoinEvents, [])
      assert.deepEqual(spoke3.testJoinEvents, [])

      spoke3.connectTo('hub')
      await condition(() => (
        setEqual(hub.getMembers(), ['hub', 'spoke-1', 'spoke-2', 'spoke-3']) &&
        setEqual(spoke1.getMembers(), ['hub', 'spoke-1', 'spoke-2', 'spoke-3']) &&
        setEqual(spoke2.getMembers(), ['hub', 'spoke-1', 'spoke-2', 'spoke-3']) &&
        setEqual(spoke3.getMembers(), ['hub', 'spoke-1', 'spoke-2', 'spoke-3'])
      ))
      assert.deepEqual(hub.testJoinEvents, ['spoke-1', 'spoke-2', 'spoke-3'])
      assert.deepEqual(spoke1.testJoinEvents, ['spoke-2', 'spoke-3'])
      assert.deepEqual(spoke2.testJoinEvents, ['spoke-3'])
      assert.deepEqual(spoke3.testJoinEvents, [])

      spoke2.disconnect()
      await condition(() => (
        setEqual(hub.getMembers(), ['hub', 'spoke-1', 'spoke-3']) &&
        setEqual(spoke1.getMembers(), ['hub', 'spoke-1', 'spoke-3']) &&
        setEqual(spoke2.getMembers(), ['spoke-2']) &&
        setEqual(spoke3.getMembers(), ['hub', 'spoke-1', 'spoke-3'])
      ))
      assert.deepEqual(hub.testLeaveEvents, [{peerId: 'spoke-2', connectionLost: false}])
      assert.deepEqual(spoke1.testLeaveEvents, [{peerId: 'spoke-2', connectionLost: false}])
      assert.deepEqual(spoke2.testLeaveEvents, [])
      assert.deepEqual(spoke3.testLeaveEvents, [{peerId: 'spoke-2', connectionLost: false}])

      hub.disconnect()
      await condition(() => (
        setEqual(hub.getMembers(), ['hub']) &&
        setEqual(spoke1.getMembers(), ['spoke-1']) &&
        setEqual(spoke2.getMembers(), ['spoke-2']) &&
        setEqual(spoke3.getMembers(), ['spoke-3'])
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

      const hub = buildStarNetwork('network', hubPool, true)
      const spoke1 = buildStarNetwork('network', spoke1Pool, false)
      const spoke2 = buildStarNetwork('network', spoke2Pool, false)
      const spoke3 = buildStarNetwork('network', spoke3Pool, false)
      await spoke1.connectTo('hub')
      await spoke2.connectTo('hub')
      await spoke3.connectTo('hub')

      spoke1Pool.disconnect()
      await condition(() => (
        setEqual(hub.getMembers(), ['hub', 'spoke-2', 'spoke-3']) &&
        setEqual(spoke1.getMembers(), ['spoke-1']) &&
        setEqual(spoke2.getMembers(), ['hub', 'spoke-2', 'spoke-3']) &&
        setEqual(spoke3.getMembers(), ['hub', 'spoke-2', 'spoke-3'])
      ))
      assert.deepEqual(hub.testLeaveEvents, [{peerId: 'spoke-1', connectionLost: true}])
      assert.deepEqual(spoke1.testLeaveEvents, [{peerId: 'hub', connectionLost: true}])
      assert.deepEqual(spoke2.testLeaveEvents, [{peerId: 'spoke-1', connectionLost: true}])
      assert.deepEqual(spoke3.testLeaveEvents, [{peerId: 'spoke-1', connectionLost: true}])

      hubPool.disconnect()
      await condition(() => (
        setEqual(hub.getMembers(), ['hub']) &&
        setEqual(spoke1.getMembers(), ['spoke-1']) &&
        setEqual(spoke2.getMembers(), ['spoke-2']) &&
        setEqual(spoke3.getMembers(), ['spoke-3'])
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
      const hubPool = await buildPeerPool('hub', server)
      const spoke1Pool = await buildPeerPool('spoke-1', server)
      const spoke2Pool = await buildPeerPool('spoke-2', server)

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
      const hubPool = await buildPeerPool('hub', server)
      const spoke1Pool = await buildPeerPool('spoke-1', server)
      const spoke2Pool = await buildPeerPool('spoke-2', server)

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
      const peer1Pool = await buildPeerPool('peer-1', server)
      const peer2Pool = await buildPeerPool('peer-2', server)
      const peer3Pool = await buildPeerPool('peer-3', server)
      const peer4Pool = await buildPeerPool('peer-4', server)

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
      const hubPool = await buildPeerPool('hub', server)
      const spoke1Pool = await buildPeerPool('spoke-1', server)
      const spoke2Pool = await buildPeerPool('spoke-2', server)
      const nonMemberPool = await buildPeerPool('non-member', server)

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

  suite('broadcastTrack', () => {
    test('streams the media track to all other members of the network', async () => {
      const hubPool = await buildPeerPool('peer-1', server)
      const spoke1Pool = await buildPeerPool('peer-2', server)
      const spoke2Pool = await buildPeerPool('peer-3', server)

      const hub = buildStarNetwork('network-a', hubPool, true)
      const spoke1 = buildStarNetwork('network-a', spoke1Pool, false)
      const spoke2 = buildStarNetwork('network-a', spoke2Pool, false)
      await spoke1.connectTo('peer-1')
      await spoke2.connectTo('peer-1')

      const stream = await getExampleMediaStream()
      const track0 = stream.getTracks()[0]
      const track1 = stream.getTracks()[1]
      hub.broadcastTrack('metadata-1', track0, stream)
      await Promise.all([
        hubPool.getNextNegotiationCompletedPromise('peer-2'),
        hubPool.getNextNegotiationCompletedPromise('peer-3')
      ])

      await condition(() => spoke1.testTracks[track0.id])
      assert.equal(spoke1.testTracks[track0.id].metadata, 'metadata-1')
      assert.equal(spoke1.testTracks[track0.id].senderId, 'peer-1')

      await condition(() => spoke2.testTracks[track0.id])
      assert.equal(spoke2.testTracks[track0.id].metadata, 'metadata-1')
      assert.equal(spoke2.testTracks[track0.id].senderId, 'peer-1')

      spoke1.broadcastTrack('metadata-2', track1, stream)
      await Promise.all([
        spoke1Pool.getNextNegotiationCompletedPromise('peer-1'),
        hubPool.getNextNegotiationCompletedPromise('peer-3')
      ])

      await condition(() => hub.testTracks[track1.id])
      assert.equal(hub.testTracks[track1.id].metadata, 'metadata-2')
      assert.equal(hub.testTracks[track1.id].senderId, 'peer-2')

      await condition(() => spoke2.testTracks[track1.id])
      assert.equal(spoke2.testTracks[track1.id].metadata, 'metadata-2')
      assert.equal(spoke2.testTracks[track1.id].senderId, 'peer-2')
    })

    test('immediately broadcasts current media tracks to new joiners unless tracks are stopped', async () => {
      const hubPool = await buildPeerPool('hub', server)
      const spoke1Pool = await buildPeerPool('spoke-1', server)
      const spoke2Pool = await buildPeerPool('spoke-2', server)

      const hub = buildStarNetwork('network-a', hubPool, true)
      const spoke1 = buildStarNetwork('network-a', spoke1Pool, false)
      const spoke2 = buildStarNetwork('network-a', spoke2Pool, false)

      const stream = await getExampleMediaStream()
      const track0 = stream.getTracks()[0]
      const track1 = stream.getTracks()[1]

      hub.broadcastTrack('metadata-1', track0, stream)

      // New spokes get tracks that the hub broadcasted previously
      await spoke1.connectTo('hub')
      await hubPool.getNextNegotiationCompletedPromise('spoke-1')
      await condition(() => spoke1.testTracks[track0.id])
      assert.equal(spoke1.testTracks[track0.id].senderId, 'hub')
      assert.equal(spoke1.testTracks[track0.id].metadata, 'metadata-1')

      spoke1.broadcastTrack('metadata-2', track1, stream)
      await spoke1Pool.getNextNegotiationCompletedPromise('hub')
      await condition(() => hub.testTracks[track1.id])

      // New spokes get tracks that other spokes broadcasted previously
      await spoke2.connectTo('hub')
      await hubPool.getNextNegotiationCompletedPromise('spoke-2')
      await condition(() => spoke2.testTracks[track0.id])
      assert.equal(spoke2.testTracks[track0.id].senderId, 'hub')
      assert.equal(spoke2.testTracks[track0.id].metadata, 'metadata-1')
      await condition(() => spoke2.testTracks[track1.id])
      assert.equal(spoke2.testTracks[track1.id].senderId, 'spoke-1')
      assert.equal(spoke2.testTracks[track1.id].metadata, 'metadata-2')

      // When tracks are stopped, it is propagated to the network
      track1.stop()
      await spoke1Pool.getNextNegotiationCompletedPromise('hub')
      await hubPool.getNextNegotiationCompletedPromise('spoke-2')

      await condition(() => hub.testTracks[track1.id].track.readyState === 'ended')
      await condition(() => spoke2.testTracks[track1.id].track.readyState === 'ended')

      // New joiners don't receive stopped tracks
      const spoke3Pool = await buildPeerPool('spoke-3', server)
      const spoke3 = buildStarNetwork('network-a', spoke3Pool, false)
      await spoke3.connectTo('hub')
      await hubPool.getNextNegotiationCompletedPromise('spoke-3')

      await condition(() => spoke3.testTracks[track0.id])
      await new Promise((r) => setTimeout(r, 100))
      assert(!spoke3.testTracks[track1.id])
    })
  })
})
