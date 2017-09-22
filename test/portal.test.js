const assert = require('assert')
const Portal = require('../lib/portal')
const {Disposable} = require('event-kit')

suite('Portal', () => {
  suite('join', () => {
    test('throws and disposes itself when a network error occurs', async () => {
      const stubPeerPool = {
        onDisconnection () {
          return new Disposable(() => {})
        },
        onReceive () {
          return new Disposable(() => {})
        }
      }
      const portal = new Portal({id: 'id', hostPeerId: 'host', siteId: 2, peerPool: stubPeerPool})
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
