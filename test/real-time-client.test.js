require('./setup')
const assert = require('assert')
const Errors = require('../lib/errors')
const RealTimeClient = require('../lib/real-time-client')

suite('RealTimeClient', () => {
  suite('initialize', () => {
    test('throws when the protocol version is out of date according to the server', async () => {
      const stubRestGateway = {
        get: (url) => {
          if (url === '/protocol-version')
          return {ok: true, body: {version: 99999}}
        }
      }
      const client = new RealTimeClient({
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

    test('throws when retrieving the client id from the pub-sub gateway exceeds the connection timeout', async () => {
      const stubRestGateway = {
        get: (url) => {
          return {ok: false}
        }
      }
      const stubPubSubGateway = {
        getClientId () {
          return new Promise(() => {})
        }
      }
      const client = new RealTimeClient({
        pubSubGateway: stubPubSubGateway,
        restGateway: stubRestGateway,
        connectionTimeout: 100
      })

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
    test('returns null if the token is invalid', async () => {
      const client = new RealTimeClient({restGateway: {}})
      client.verifyOauthToken = async function () {
        return {success: false}
      }

      assert(!await client.createPortal())
    })

    test('throws if posting the portal to the server fails', async () => {
      const stubRestGateway = {}
      const client = new RealTimeClient({
        restGateway: stubRestGateway,
      })
      client.verifyOauthToken = async function () {
        return {success: true}
      }

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
    test('returns null if the token is invalid', async () => {
      const client = new RealTimeClient({restGateway: {}})
      client.verifyOauthToken = async function () {
        return {success: false}
      }

      assert(!await client.joinPortal('some-portal'))
    })

    test('throws if retrieving the portal from the server fails', async () => {
      const stubRestGateway = {}
      const client = new RealTimeClient({restGateway: stubRestGateway})
      client.verifyOauthToken = async function () {
        return {success: true}
      }

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
      const client = new RealTimeClient({
        pubSubGateway: stubPubSubGateway,
        restGateway: stubRestGateway
      })
      client.onConnectionError((error) => errorEvents.push(error))
      await client.initialize()

      const errorEvent1 = new ErrorEvent('')
      client.peerPool.emitter.emit('error', errorEvent1)
      assert.deepEqual(errorEvents, [errorEvent1])

      const errorEvent2 = new ErrorEvent('')
      client.peerPool.emitter.emit('error', errorEvent2)
      assert.deepEqual(errorEvents, [errorEvent1, errorEvent2])
    })
  })

  suite('signIn(token)', () => {
    test('returns true and emits an event when the given token is valid', async () => {
      const stubRestGateway = {
        get (url) {
          return {ok: true, status: 200, body: {login: 'some-user'}}
        }
      }
      const client = new RealTimeClient({
        pubSubGateway: {},
        restGateway: stubRestGateway
      })
      client.peerPool = {
        setLocalPeerIdentity (token, identity) {
          this.identity = identity
        },
        getLocalPeerIdentity () {
          return this.identity
        }
      }

      let signInChangeEventsCount = 0
      client.onSignInChange(() => signInChangeEventsCount++)

      const signedIn = await client.signIn('some-token')
      assert(signedIn)
      assert(client.isSignedIn())
      assert.deepEqual(client.getLocalUserIdentity(), {login: 'some-user'})
      assert.equal(signInChangeEventsCount, 1)
    })

    test('returns false when the given token is invalid', async () => {
      const stubRestGateway = {
        get (url) {
          return {ok: false, status: 401, body: {}}
        }
      }
      const client = new RealTimeClient({
        pubSubGateway: {},
        restGateway: stubRestGateway
      })

      assert(!await client.signIn('some-token'))
    })
  })

  suite('verifyOauthToken', () => {
    test('returns the identity of the user with the given token', async () => {
      const stubRestGateway = {
        get (url) {
          return {ok: true, status: 200, body: {login: 'some-user'}}
        }
      }
      const client = new RealTimeClient({
        pubSubGateway: {},
        restGateway: stubRestGateway
      })

      const {success, identity} = await client.verifyOauthToken()
      assert(success)
      assert.deepEqual(identity, {login: 'some-user'})
    })

    test('signs out the client when the given token is invalid', async () => {
      const stubRestGateway = {
        get (url) {
          return {ok: false, status: 401, body: {}}
        }
      }
      const client = new RealTimeClient({
        pubSubGateway: {},
        restGateway: stubRestGateway
      })
      client.peerPool = {
        oauthToken: 'some-token',
        identity: {login: 'some-user'},
        disconnected: false,
        disconnect () {
          this.disconnected = true
        },
        setLocalPeerIdentity (oauthToken, identity) {
          this.oauthToken = oauthToken
          this.identity = identity
        },
        getLocalPeerIdentity () {
          return this.identity
        }
      }
      client.signedIn = true

      let signInChangeEventsCount = 0
      client.onSignInChange(() => signInChangeEventsCount++)

      const {success} = await client.verifyOauthToken()
      assert(!success)
      assert(!client.signedIn)
      assert(!client.getLocalUserIdentity())
      assert(!client.peerPool.oauthToken)
      assert(client.peerPool.disconnected)
      assert.equal(signInChangeEventsCount, 1)
    })

    test('throws when an unexpected authentication failure occurs', async () => {
      const stubRestGateway = {
        get (url) {
          return {ok: false, status: 500, body: 'whoops'}
        }
      }
      const client = new RealTimeClient({
        pubSubGateway: {},
        restGateway: stubRestGateway
      })

      let error
      try {
        await client.verifyOauthToken()
      } catch (e) {
        error = e
      }
      assert(error instanceof Errors.UnexpectedAuthenticationError)
    })
  })
})
