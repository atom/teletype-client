require('./setup')
const assert = require('assert')
const Errors = require('../lib/errors')
const RealTimeClient = require('../lib/real-time-client')

suite('RealTimeClient', () => {
  suite('initialize', () => {
    test('waiting too long to retrieve the client id from the pub-sub gateway', async () => {
      const pubSubGateway = {
        getClientId () {
          return new Promise(() => {})
        }
      }
      const client = new RealTimeClient({pubSubGateway, connectionTimeout: 100})

      let error
      try {
        await client.initialize()
      } catch (e) {
        error = e
      }
      assert(error instanceof Errors.PubSubConnectionError)
    })
  })

  suite('createPortal', () => {
    test('throws if posting the portal to the server fails', async () => {
      const stubRestGateway = {}
      const client = new RealTimeClient({restGateway: stubRestGateway})

      {
        let error
        try {
          stubRestGateway.post = function () {
            throw new Error('Failed to fetch')
          }
          await client.createPortal()
        } catch (e) {
          error = e
        }
        assert(error instanceof Errors.PortalCreationError)
      }

      {
        let error
        try {
          stubRestGateway.post = function () {
            return Promise.resolve({ok: false, body: {}})
          }
          await client.createPortal()
        } catch (e) {
          error = e
        }
        assert(error instanceof Errors.PortalCreationError)
      }
    })
  })

  suite('joinPortal', () => {
    test('throws if retrieving the portal from the server fails', async () => {
      const stubRestGateway = {}
      const client = new RealTimeClient({restGateway: stubRestGateway})

      {
        let error
        try {
          stubRestGateway.get = function () {
            throw new Error('Failed to fetch')
          }
          await client.joinPortal('1')
        } catch (e) {
          error = e
        }
        assert(error instanceof Errors.PortalJoinError)
      }

      {
        let error
        try {
          stubRestGateway.get = function () {
            return Promise.resolve({ok: false, body: {}})
          }
          await client.joinPortal('1')
        } catch (e) {
          error = e
        }
        assert(error instanceof Errors.PortalNotFoundError)
      }
    })
  })

  suite('onError', () => {
    test('fires if the underlying PeerPool emits an error', async () => {
      const stubRestGateway = {
        get () {
          return Promise.resolve({ok: true, body: []})
        }
      }
      const stubPubSubGateway = {
        getClientId () {
          return Promise.resolve('')
        },
        subscribe () {}
      }
      const errorEvents = []
      const client = new RealTimeClient({pubSubGateway: stubPubSubGateway, restGateway: stubRestGateway})
      client.onError((error) => errorEvents.push(error))
      await client.initialize()

      const errorEvent1 = new ErrorEvent('')
      client.peerPool.emitter.emit('error', errorEvent1)
      assert.deepEqual(errorEvents, [errorEvent1])

      const errorEvent2 = new ErrorEvent('')
      client.peerPool.emitter.emit('error', errorEvent2)
      assert.deepEqual(errorEvents, [errorEvent1, errorEvent2])
    })
  })
})
