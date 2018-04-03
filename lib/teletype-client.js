const os = require('os')
const uuidV1 = require('uuid/v1')
const uuidV4 = require('uuid/v4')
const PeerPool = require('./peer-pool')
const Portal = require('./portal')
const Errors = require('./errors')
const PusherPubSubGateway = require('./pusher-pub-sub-gateway')
const RestGateway = require('./rest-gateway')
const {Emitter} = require('event-kit')
const NOOP = () => {}
const DEFAULT_TETHER_DISCONNECT_WINDOW = 1000
const LOCAL_PROTOCOL_VERSION = 9

module.exports =
class TeletypeClient {
  constructor ({restGateway, pubSubGateway, connectionTimeout, tetherDisconnectWindow, testEpoch, pusherKey, pusherOptions, baseURL, didCreateOrJoinPortal}) {
    this.restGateway = restGateway || new RestGateway({baseURL})
    this.pubSubGateway = pubSubGateway || new PusherPubSubGateway({key: pusherKey, options: pusherOptions})
    this.connectionTimeout = connectionTimeout || 5000
    this.tetherDisconnectWindow = tetherDisconnectWindow || DEFAULT_TETHER_DISCONNECT_WINDOW
    this.testEpoch = testEpoch
    this.didCreateOrJoinPortal = didCreateOrJoinPortal || NOOP
    this.emitter = new Emitter()
  }

  async initialize () {
    const {ok, body} = await this.restGateway.get('/protocol-version')
    if (ok && body.version > LOCAL_PROTOCOL_VERSION) {
      throw new Errors.ClientOutOfDateError(`This version teletype-client is out of date. The local version is ${LOCAL_PROTOCOL_VERSION} but the remote version is ${body.version}.`)
    }
  }

  dispose () {
    if (this.peerPool) this.peerPool.dispose()
  }

  async signIn (oauthToken) {
    this.restGateway.setOauthToken(oauthToken)

    let response
    try {
      response = await this.restGateway.get('/identity')
    } catch (error) {
      const message = 'Authentication failed with message: ' + error.message
      throw new Errors.UnexpectedAuthenticationError(message)
    }

    if (response.ok) {
      this.peerPool = new PeerPool({
        peerId: this.getClientId(),
        peerIdentity: response.body,
        restGateway: this.restGateway,
        pubSubGateway: this.pubSubGateway,
        fragmentSize: 16 * 1024, // 16KB
        connectionTimeout: this.connectionTimeout,
        testEpoch: this.testEpoch
      })
      this.peerPool.onError(this.peerPoolDidError.bind(this))
      await this.peerPool.initialize()

      this.signedIn = true
      this.emitter.emit('sign-in-change')

      return true
    } else if (response.status === 401) {
      return false
    } else {
      const message = 'Authentication failed with message: ' + response.body.message
      throw new Errors.UnexpectedAuthenticationError(message)
    }
  }

  signOut () {
    if (this.signedIn) {
      this.signedIn = false
      this.restGateway.setOauthToken(null)
      this.peerPool.dispose()
      this.peerPool = null
      this.emitter.emit('sign-in-change')
    }

    return true
  }

  isSignedIn () {
    return this.signedIn
  }

  getLocalUserIdentity () {
    return this.peerPool ? this.peerPool.getLocalPeerIdentity() : null
  }

  async createPortal () {
    let result
    try {
      result = await this.restGateway.post('/portals', {hostPeerId: this.getClientId()})
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
      await portal.initialize()
      this.didCreateOrJoinPortal(portal)

      return portal
    } else if (result.status === 401) {
      this.signOut()
    } else {
      throw new Errors.PortalCreationError('A server error occurred while creating your portal')
    }
  }

  async joinPortal (id) {
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
      await portal.initialize()
      await portal.join()
      this.didCreateOrJoinPortal(portal)

      return portal
    } else if (result.status === 401) {
      this.signOut()
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

  getClientId () {
    if (!this.clientId) {
      const EMPTY_MAC_ADDRESS = '00:00:00:00:00:00'
      const networkInterfaces = os.networkInterfaces()

      let macAddress
      for (const networkInterfaceName in networkInterfaces) {
        const networkAddress = networkInterfaces[networkInterfaceName][0]
        if (networkAddress && !networkAddress.internal && networkAddress.mac !== EMPTY_MAC_ADDRESS) {
          macAddress = networkAddress.mac
          break
        }
      }

      if (macAddress) {
        // If we can find a MAC address string, we first transform it into a sequence
        // of bytes. Then, we construct the clientId by concatenating two UUIDs:
        // * A UUIDv1, built using the MAC address so that it is guaranteed to be unique.
        // * A UUIDv4, built using random bytes so that the clientId can't be guessed.
        const macAddressBytes = macAddress.split(':').map((part) => Buffer.from(part, 'hex').readUInt8())
        this.clientId = uuidV1({node: macAddressBytes}) + '.' + uuidV4()
      } else {
        // If no MAC address could be found, generate a completely random clientId with the same format.
        this.clientId = uuidV4() + '.' + uuidV4()
      }
    }

    return this.clientId
  }

  peerPoolDidError (error) {
    if (error instanceof Errors.InvalidAuthenticationTokenError) {
      this.signOut()
    } else {
      this.emitter.emit('connection-error', error)
    }
  }
}
