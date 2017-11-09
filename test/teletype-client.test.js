require('./setup')
const assert = require('assert')
const Errors = require('../lib/errors')
const TeletypeClient = require('../lib/teletype-client')

suite('TeletypeClient', () => {
  suite('initialize', () => {
    test('throws when the protocol version is out of date according to the server', async () => {
      const stubRestGateway = {
        get: (url) => {
          if (url === '/protocol-version')
          return {ok: true, body: {version: 99999}}
        }
      }
      const client = new TeletypeClient({
        restGateway: stubRestGateway,
        pubSubGateway: {}
      })

      let error
      try {
        await client.initialize()
      } catch (e) {
        error = e
      }
      assert(error instanceof Errors.ClientOutOfDateError)
    })
  })

  suite('signIn(oauthToken)', () => {
    test('throws when the server replies with an unexpected status code', async () => {
      const stubPubSubGateway = {}
      const stubRestGateway = {
        setOauthToken () {}
      }
      const client = new TeletypeClient({restGateway: stubRestGateway, pubSubGateway: stubPubSubGateway})

      {
        let error
        try {
          stubRestGateway.get = function () {
            return {ok: false, status: 489, body: {message: 'some-error'}}
          }
          await client.signIn('token')
        } catch (e) {
          error = e
        }
        assert(error instanceof Errors.UnexpectedAuthenticationError)
        assert(error.message.includes('some-error'))
      }
    })

    test('throws when contacting the server fails', async () => {
      const stubPubSubGateway = {}
      const stubRestGateway = {
        setOauthToken () {}
      }
      const client = new TeletypeClient({restGateway: stubRestGateway, pubSubGateway: stubPubSubGateway})

      {
        let error
        try {
          stubRestGateway.get = function () {
            throw new Error('Failed to fetch')
          }
          await client.signIn('token')
        } catch (e) {
          error = e
        }
        assert(error instanceof Errors.UnexpectedAuthenticationError)
      }
    })
  })

  suite('createPortal', () => {
    test('throws if posting the portal to the server fails', async () => {
      const stubPubSubGateway = {}
      const stubRestGateway = {}
      const client = new TeletypeClient({restGateway: stubRestGateway, pubSubGateway: stubPubSubGateway})

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
      const stubPubSubGateway = {}
      const stubRestGateway = {}
      const client = new TeletypeClient({restGateway: stubRestGateway, pubSubGateway: stubPubSubGateway})

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

  suite('onConnectionError', () => {
    test('fires if the underlying PeerPool emits an error', async () => {
      const stubRestGateway = {
        setOauthToken () {},
        get () {
          return Promise.resolve({ok: true, body: []})
        }
      }
      const stubPubSubGateway = {
        subscribe () {
          return Promise.resolve({
            dispose () {}
          })
        }
      }
      const errorEvents = []
      const client = new TeletypeClient({
        pubSubGateway: stubPubSubGateway,
        restGateway: stubRestGateway
      })
      client.onConnectionError((error) => errorEvents.push(error))
      await client.initialize()
      await client.signIn('some-token')

      const errorEvent1 = new ErrorEvent('')
      client.peerPool.emitter.emit('error', errorEvent1)
      assert.deepEqual(errorEvents, [errorEvent1])

      const errorEvent2 = new ErrorEvent('')
      client.peerPool.emitter.emit('error', errorEvent2)
      assert.deepEqual(errorEvents, [errorEvent1, errorEvent2])
    })
  })
})
