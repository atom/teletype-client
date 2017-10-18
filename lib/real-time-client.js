const PeerPool = require('./peer-pool')
const Portal = require('./portal')
const Errors = require('./errors')
const PusherPubSubGateway = require('./pusher-pub-sub-gateway')
const RestGateway = require('./rest-gateway')
const {Emitter} = require('event-kit')
const NOOP = () => {}
const DEFAULT_TETHER_DISCONNECT_WINDOW = 1000
const LOCAL_PROTOCOL_VERSION = 2

module.exports =
class RealTimeClient {
  constructor ({restGateway, pubSubGateway, connectionTimeout, tetherDisconnectWindow, testEpoch, pusherKey, baseURL, didCreateOrJoinPortal}) {
    this.pusherKey = pusherKey
    this.restGateway = restGateway || new RestGateway({baseURL})
    this.pubSubGateway = pubSubGateway
    this.connectionTimeout = connectionTimeout || 5000
    this.tetherDisconnectWindow = tetherDisconnectWindow || DEFAULT_TETHER_DISCONNECT_WINDOW
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
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway,
      fragmentSize: 16 * 1024, // 16KB
      connectionTimeout: this.connectionTimeout,
      testEpoch: this.testEpoch
    })
    await this.peerPool.initialize()
    this.peerPool.onError(this.peerPoolDidError.bind(this))
  }

  dispose () {
    if (this.peerPool) this.peerPool.disconnect()
  }

  async signIn (oauthToken) {
    this.oauthToken = oauthToken
    const {success, identity} = await this.verifyOauthToken()
    if (success) {
      this.signedIn = true
      this.peerPool.setLocalPeerIdentity(this.oauthToken, identity)
      this.emitter.emit('sign-in-change')
      return true
    } else {
      return false
    }
  }

  signOut () {
    this.signedIn = false
    this.oauthToken = null
    this.peerPool.setLocalPeerIdentity(null, null)
    this.peerPool.disconnect()
    this.emitter.emit('sign-in-change')
    return true
  }

  isSignedIn () {
    return this.signedIn
  }

  getLocalUserIdentity () {
    return this.peerPool.getLocalPeerIdentity()
  }

  async createPortal () {
    // TODO: avoid extra round-trip by authenticating POST /portals

    const {success} = await this.verifyOauthToken()
    if (!success) return

    let result
    try {
      result = await this.restGateway.post('/portals', {hostPeerId: this.peerId})
    } catch (error) {
      throw new Errors.PortalCreationError('Could not contact server to create your portal')
    }

    if (result.ok) {
      const {id} = result.body
      const portal = new Portal({
        id,
        siteId: 1,
        peerPool: this.peerPool,
        connectionTimeout: this.connectionTimeout,
        tetherDisconnectWindow: this.tetherDisconnectWindow
      })
      this.didCreateOrJoinPortal(portal)

      return portal
    } else {
      throw new Errors.PortalCreationError('A server error occurred while creating your portal')
    }
  }

  async joinPortal (id) {
    // TODO: avoid extra round-trip by authenticating GET /portals/:id

    const {success} = await this.verifyOauthToken()
    if (!success) return

    let result
    try {
      result = await this.restGateway.get(`/portals/${id}`)
    } catch (error) {
      throw new Errors.PortalJoinError('Could not contact server to join the portal')
    }

    if (result.ok) {
      const {hostPeerId} = result.body
      const portal = new Portal({
        id,
        hostPeerId,
        peerPool: this.peerPool,
        connectionTimeout: this.connectionTimeout,
        tetherDisconnectWindow: this.tetherDisconnectWindow
      })
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

  onSignInChange (callback) {
    return this.emitter.on('sign-in-change', callback)
  }

  async verifyOauthToken () {
    const headers = {'GitHub-OAuth-token': this.oauthToken}
    const {ok, status, body} = await this.restGateway.get('/identity', {headers})

    if (ok) {
      return {success: true, identity: body}
    } else if (status === 401) {
      if (this.signedIn) this.signOut()

      return {success: false}
    } else {
      throw new Errors.UnexpectedAuthenticationError('Authentication failed with message: ' + body.message)
    }
  }

  getClientId () {
    const timeoutError = new Errors.PubSubConnectionError('Timed out establishing web socket connection to signaling server')
    return new Promise((resolve, reject) => {
      this.pubSubGateway.getClientId().then(resolve)
      setTimeout(() => reject(timeoutError), this.connectionTimeout)
    })
  }

  async ensureProtocolCompatibility () {
    const {ok, body} = await this.restGateway.get('/protocol-version')
    if (ok && body.version > LOCAL_PROTOCOL_VERSION) {
      throw new Errors.ClientOutOfDateError(`This version real-time-client is out of date. The local version is ${LOCAL_PROTOCOL_VERSION} but the remote version is ${body.version}.`)
    }
  }

  peerPoolDidError (error) {
    if (error instanceof Errors.InvalidAuthenticationTokenError) {
      this.signOut()
    } else {
      this.emitter.emit('connection-error', error)
    }
  }
}
