require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const {startTestServer} = require('@atom/real-time-server')
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
    return server.reset()
  })

  suite('unicast', () => {
    test('sends messages to only one member of the network', async () => {
      const hubPool = await buildPeerPool('hub', server)
      const spoke1Pool = await buildPeerPool('spoke-1', server)
      const spoke2Pool = await buildPeerPool('spoke-2', server)

      const hub = buildStarNetwork('network-a', hubPool, true)
      const spoke1 = buildStarNetwork('network-a', spoke1Pool, false)
      const spoke2 = buildStarNetwork('network-a', spoke2Pool, false)
      spoke1.connectTo('hub')
      spoke2.connectTo('hub')
      await condition(() => hub.hasMember('spoke-1') && hub.hasMember('spoke-2'))

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
      spokeA1.connectTo('peer-1')
      spokeA2.connectTo('peer-1')
      await condition(() => hubA.hasMember('peer-2') && hubA.hasMember('peer-3'))

      const hubB = buildStarNetwork('network-b', peer1Pool, true)
      const spokeB1 = buildStarNetwork('network-b', peer2Pool, false)
      const spokeB2 = buildStarNetwork('network-b', peer3Pool, false)
      spokeB1.connectTo('peer-1')
      spokeB2.connectTo('peer-1')
      await condition(() => hubB.hasMember('peer-2') && hubB.hasMember('peer-3'))

      const hubC = buildStarNetwork('network-c', peer2Pool, true)
      const spokeC1 = buildStarNetwork('network-c', peer1Pool, false)
      const spokeC2 = buildStarNetwork('network-c', peer3Pool, false)
      spokeC1.connectTo('peer-2')
      spokeC2.connectTo('peer-2')
      await condition(() => hubC.hasMember('peer-1') && hubC.hasMember('peer-3'))

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
      spoke1.connectTo('hub')
      spoke2.connectTo('hub')
      await condition(() => hub.hasMember('spoke-1') && hub.hasMember('spoke-2'))

      await nonMemberPool.connectTo('hub')

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
