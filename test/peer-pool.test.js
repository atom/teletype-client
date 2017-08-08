require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const {startTestServer} = require('@atom/real-time-server')
const condition = require('./helpers/condition')
const buildPeerPool = require('./helpers/build-peer-pool')
const getExampleMediaStream = require('./helpers/get-example-media-stream')

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
    peer1Pool.connectTo('3')
    peer2Pool.connectTo('3')

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

  test('streaming media tracks between peers', async function () {
    const peer1Pool = await buildPeerPool('1', server)
    const peer2Pool = await buildPeerPool('2', server)
    const peer3Pool = await buildPeerPool('3', server)
    const stream = await getExampleMediaStream()
    const track0 = stream.getTracks()[0]
    const track1 = stream.getTracks()[1]

    peer1Pool.addMediaTrack('2', track0, stream)
    await peer1Pool.connectTo('2')
    await peer2Pool.getConnectedPromise('1')

    await condition(() =>
      peer2Pool.testMediaTracks['1'] && peer2Pool.testMediaTracks['1'][track0.id]
    )

    peer1Pool.addMediaTrack('2', track1, stream)
    await peer1Pool.getNextNegotiationCompletedPromise('2')
    await condition(() =>
      peer2Pool.testMediaTracks['1'][track1.id]
    )

    // Verify that renegotiation can be initiated by the party that didn't
    // initiate the original connection
    await peer1Pool.connectTo('3')
    await peer3Pool.getConnectedPromise('1')
    peer3Pool.addMediaTrack('1', track0, stream)
    await peer3Pool.getNextNegotiationCompletedPromise('1')

    await condition(() =>
      peer1Pool.testMediaTracks['3'] && peer1Pool.testMediaTracks['3'][track0.id]
    )
  })
})
