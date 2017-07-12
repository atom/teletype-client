require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const PeerRegistry = require('../lib/peer-registry')
const {startTestServer} = require('@atom/real-time-server')

suite('PeerRegistry', () => {
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
    const peer1Registry = new PeerRegistry({
      peerId: '1',
      restGateway: server.restGateway,
      pubSubGateway: server.pubSubGateway,
      delegate: {
        didReceiveIncomingConnection () {}
      }
    })
    await peer1Registry.subscribe()

    let peer2ConnectionToPeer1
    const peer2Registry = new PeerRegistry({
      peerId: '2',
      restGateway: server.restGateway,
      pubSubGateway: server.pubSubGateway,
      delegate: {
        didReceiveIncomingConnection (peerId, connection) {
          assert.equal(peerId, '1')
          peer2ConnectionToPeer1 = connection
        }
      },
      fragmentSize: 10
    })
    await peer2Registry.subscribe()

    // Connection
    const peer1ConnectionToPeer2 = await peer1Registry.connect('2')
    await condition(() => peer2ConnectionToPeer1 != null)

    const peer2Inbox = []
    peer2ConnectionToPeer1.onReceive((message) => {
      peer2Inbox.push(message.toString())
    })

    // Single-part messages
    peer1ConnectionToPeer2.send(Buffer.from('hello'))
    await condition(() => deepEqual(peer2Inbox, ['hello']))
    peer2Inbox.length = 0

    // Multi-part messages
    const longMessage = 'x'.repeat(22)
    peer1ConnectionToPeer2.send(Buffer.from(longMessage))
    await condition(() => deepEqual(peer2Inbox, [longMessage]))
    peer2Inbox.length = 0
  })
})

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
