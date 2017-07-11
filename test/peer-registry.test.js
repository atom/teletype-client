require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const PeerRegistry = require('../lib/peer-registry')
const {startTestServer} = require('@atom/real-time-server')

suite('PeerRegistry', () => {
  let server

  suiteSetup(async () => {
    server = await startTestServer({
      databaseURL: process.env.TEST_DATABASE_URL,
      maxMessageSizeInBytes: 100
    })
  })

  suiteTeardown(() => {
    return server.stop()
  })

  setup(() => {
    return server.reset()
  })

  test('initiating and receiving peer-to-peer connections', async () => {
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

    const peer1ConnectionToPeer2 = await peer1Registry.connect('2')
    await condition(() => peer2ConnectionToPeer1 != null)

    const disposable1 = peer2ConnectionToPeer1.onRequest(({requestId, request}) => {
      assert.equal(request.toString(), 'marco')
      peer2ConnectionToPeer1.respond(requestId, Buffer.from('polo'))
    })

    {
      const response = await peer1ConnectionToPeer2.request(Buffer.from('marco'))
      assert.equal(response.toString(), 'polo')
    }

    // Test a request and response that exceed the fragment size
    const longRequest = 'x'.repeat(22)
    const longResponse = 'y'.repeat(22)

    disposable1.dispose()
    peer2ConnectionToPeer1.onRequest(({requestId, request}) => {
      assert.equal(request.toString(), longRequest)
      peer2ConnectionToPeer1.respond(requestId, Buffer.from(longResponse))
    })

    {
      const response = await peer1ConnectionToPeer2.request(Buffer.from(longRequest))
      assert.equal(response.toString(), longResponse)
    }
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
