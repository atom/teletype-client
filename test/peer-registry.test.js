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

  test.only('initiating and receiving peer-to-peer connections', async () => {
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
      }
    })
    await peer2Registry.subscribe()

    const peer1ConnectionToPeer2 = await peer1Registry.connect('2')
    await condition(() => peer2ConnectionToPeer1 != null)

    peer2MessagesFromPeer1 = []
    peer2ConnectionToPeer1.on('data', (data) => {
      peer2MessagesFromPeer1.push(data.toString())
      peer2ConnectionToPeer1.send('world')
    })

    peer1MessagesFromPeer2 = []
    peer1ConnectionToPeer2.on('data', (data) => {
      peer1MessagesFromPeer2.push(data.toString())
    })

    peer1ConnectionToPeer2.send('hello')

    await condition(() =>
      deepEqual(peer2MessagesFromPeer1, ['hello']) &&
      deepEqual(peer1MessagesFromPeer2, ['world'])
    )
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
