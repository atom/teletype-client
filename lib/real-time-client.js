const PeerPool = require('./peer-pool')
const Portal = require('./portal')
const Errors = require('./errors')
const PusherPubSubGateway = require('./pusher-pub-sub-gateway')
const RestGateway = require('./rest-gateway')
const {Emitter} = require('event-kit')
const NOOP = () => {}
const LOCAL_PROTOCOL_VERSION = 2

module.exports =
class RealTimeClient {
  constructor ({authTokenProvider, restGateway, pubSubGateway, connectionTimeout, testEpoch, pusherKey, baseURL, didCreateOrJoinPortal}) {
    this.authTokenProvider = authTokenProvider
    this.pusherKey = pusherKey
    this.restGateway = restGateway || new RestGateway({baseURL})
    this.pubSubGateway = pubSubGateway
    this.connectionTimeout = connectionTimeout || 5000
    this.testEpoch = testEpoch
    this.didCreateOrJoinPortal = didCreateOrJoinPortal || NOOP
    this.emitter = new Emitter()
  }

  async initialize () {
    if (!this.initializationPromise) {
      this.initializationPromise = this._initialize()
      this.initializationPromise.catch(() => {
        this.initializationPromise = null
      })
    }

    return this.initializationPromise
  }

  async _initialize () {
    if (!this.pubSubGateway) this.pubSubGateway = new PusherPubSubGateway({key: this.pusherKey})
    await this.ensureProtocolCompatibility()
    this.peerId = await this.getClientId()
    this.peerPool = new PeerPool({
      peerId: this.peerId,
      authTokenProvider: this.authTokenProvider,
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway,
      fragmentSize: 16 * 1024, // 16KB
      connectionTimeout: this.connectionTimeout,
      testEpoch: this.testEpoch
    })
    await this.peerPool.initialize()
    this.peerPool.onError((error) => this.emitter.emit('connection-error', error))
  }

  dispose () {
    if (this.peerPool) this.peerPool.disconnect()
  }

  async createPortal () {
    if (!await this.authenticate()) return

    let result
    try {
      result = await this.restGateway.post('/portals', {hostPeerId: this.peerId})
    } catch (error) {
      throw new Errors.PortalCreationError('Could not contact server to create your portal')
    }

    if (result.ok) {
      const {id} = result.body
      const portal = new Portal({id, siteId: 1, peerPool: this.peerPool, connectionTimeout: this.connectionTimeout})
      this.didCreateOrJoinPortal(portal)

      return portal
    } else {
      throw new Errors.PortalCreationError('A server error occurred while creating your portal')
    }
  }

  async joinPortal (id) {
    if (!await this.authenticate()) return

    let result
    try {
      result = await this.restGateway.get(`/portals/${id}`)
    } catch (error) {
      throw new Errors.PortalJoinError('Could not contact server to join the portal')
    }

    if (result.ok) {
      const {hostPeerId} = result.body
      const portal = new Portal({id, hostPeerId, peerPool: this.peerPool, connectionTimeout: this.connectionTimeout})
      await portal.join()
      this.didCreateOrJoinPortal(portal)

      return portal
    } else {
      throw new Errors.PortalNotFoundError()
    }
  }

  onConnectionError (callback) {
    return this.emitter.on('connection-error', callback)
  }

  getClientId () {
    const timeoutError = new Errors.PubSubConnectionError('Timed out establishing web socket connection to signaling server')
    return new Promise((resolve, reject) => {
      this.pubSubGateway.getClientId().then(resolve)
      setTimeout(() => reject(timeoutError), this.connectionTimeout)
    })
  }

  async authenticate () {
    while (true) {
      const oauthToken = await this.authTokenProvider.getToken(true)
      if (oauthToken) {
        const {ok, status, body} = await this.restGateway.get('/identity', {
          headers: {'GitHub-OAuth-token': oauthToken}
        })
        if (ok) {
          this.peerPool.setLocalPeerIdentity(body)
          return true
        } else if (status === 401) {
          this.authTokenProvider.didInvalidateToken()
        } else {
          throw new Errors.AuthenticationError('Authentication failed with message: ' + body.message)
        }
      } else {
        return false
      }
    }
  }

  async ensureProtocolCompatibility () {
    const {ok, body} = await this.restGateway.get('/protocol-version')
    if (ok && body.version > LOCAL_PROTOCOL_VERSION) {
      throw new Errors.ClientOutOfDateError(`This version real-time-client is out of date. The local version is ${LOCAL_PROTOCOL_VERSION} but the remote version is ${body.version}.`)
    }
  }
}
