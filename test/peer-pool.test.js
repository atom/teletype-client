require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const condition = require('./helpers/condition')
const buildPeerPool = require('./helpers/build-peer-pool')
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
    peer1Pool.connectTo('3')
    peer2Pool.connectTo('3')
    await condition(() => (
      peer1Pool.isConnectedToPeer('3') &&
      peer2Pool.isConnectedToPeer('3') &&
      peer3Pool.isConnectedToPeer('1') && peer3Pool.isConnectedToPeer('2')
    ))

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
    await condition(() => (
      peer1Pool.isConnectedToPeer('3') &&
      !peer2Pool.isConnectedToPeer('3') &&
      peer3Pool.isConnectedToPeer('1') && !peer3Pool.isConnectedToPeer('2')
    ))
    assert.deepEqual(peer1Pool.testDisconnectionEvents, [])
    assert.deepEqual(peer2Pool.testDisconnectionEvents, ['3'])
    assert.deepEqual(peer3Pool.testDisconnectionEvents, ['2'])

    peer3Pool.disconnect()
    await condition(() => (
      !peer1Pool.isConnectedToPeer('3') &&
      !peer3Pool.isConnectedToPeer('1')
    ))
    assert.deepEqual(peer1Pool.testDisconnectionEvents, ['3'])
    assert.deepEqual(peer2Pool.testDisconnectionEvents, ['3'])
    assert.deepEqual(peer3Pool.testDisconnectionEvents, ['2', '1'])
  })
})
