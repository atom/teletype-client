const assert = require('assert')
const Portal = require('../lib/portal')
const {Disposable} = require('event-kit')
const {startTestServer} = require('@atom/real-time-server')
const {buildPeerPool, clearPeerPools} = require('./helpers/peer-pools')

suite('Portal', () => {
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

  suite('join', () => {
    test('throws and disposes itself when a network error occurs', async () => {
      const peerPool = await buildPeerPool('guest', server)
      const portal = new Portal({id: 'id', hostPeerId: 'host', siteId: 2, peerPool})
      portal.network.connectTo = function () {
        throw new Error('an error')
      }

      let error
      try {
        await portal.join()
      } catch (e) {
        error = e
      }
      assert.equal(error.message, 'an error')
      assert(portal.disposed)
    })
  })
})
