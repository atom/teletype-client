const assert = require('assert')
const {Emitter} = require('event-kit')
const PeerConnection = require('./peer-connection')
const PubSubSignalingProvider = require('./pub-sub-signaling-provider')
const Errors = require('./errors')

module.exports =
class PeerPool {
  constructor ({peerId, authTokenProvider, restGateway, pubSubGateway, fragmentSize, connectionTimeout, testEpoch}) {
    this.peerId = peerId
    this.authTokenProvider = authTokenProvider
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.fragmentSize = fragmentSize
    this.connectionTimeout = connectionTimeout || 5000
    this.testEpoch = testEpoch
    this.emitter = new Emitter()
    this.peerConnectionsById = new Map()
    this.peerIdentitiesById = new Map()
  }

  initialize () {
    return Promise.all([
      this.fetchICEServers(),
      this.fetchLocalPeerIdentity(),
      this.waitForIncomingSignals()
    ])
  }

  async fetchICEServers () {
    const {body: iceServers, ok} = await this.restGateway.get('/ice-servers')
    assert(Array.isArray(iceServers), 'ICE servers must be an Array')
    this.iceServers = iceServers
  }

  async fetchLocalPeerIdentity () {
    const oauthToken = await this.authTokenProvider.getToken()
    const {body, ok, status} = await this.restGateway.get('/identity', {
      headers: {'GitHub-OAuth-token': oauthToken}
    })

    if (ok) {
      this.peerIdentitiesById.set(this.peerId, body)
    } else {
      if (status === 401) {
        this.authTokenProvider.forgetToken()
        throw new Errors.InvalidAuthTokenError()
      } else {
        throw new Errors.NetworkConnectionError('Could not fetch your identity from the server')
      }
    }
  }

  waitForIncomingSignals () {
    const timeoutError = new Errors.PubSubConnectionError('Timed out while subscribing to incoming signals')
    return new Promise(async (resolve, reject) => {
      let rejected = false
      const timeoutId = window.setTimeout(() => {
        reject(timeoutError)
        rejected = true
      }, this.connectionTimeout)

      const subscription = await this.pubSubGateway.subscribe(
        `/peers/${this.peerId}`,
        'signal',
        this.didReceiveSignal.bind(this)
      )
      if (rejected) {
        subscription.dispose()
      } else {
        window.clearTimeout(timeoutId)
        resolve()
      }
    })
  }

  async connectTo (peerId) {
    const peerConnection = this.getPeerConnection(peerId)

    try {
      await peerConnection.connect()
    } catch (error) {
      this.peerConnectionsById.delete(peerId)
      throw error
    }
  }

  getConnectedPromise (peerId) {
    return this.getPeerConnection(peerId).getConnectedPromise()
  }

  getDisconnectedPromise (peerId) {
    if (this.peerConnectionsById.has(peerId)) {
      return this.peerConnectionsById.get(peerId).getDisconnectedPromise()
    } else {
      return Promise.resolve()
    }
  }

  disconnect () {
    this.disconnected = true
    this.peerConnectionsById.forEach((peerConnection) => {
      peerConnection.disconnect()
    })
    this.peerConnectionsById.clear()
  }

  send (peerId, message) {
    const peerConnection = this.peerConnectionsById.get(peerId)
    if (peerConnection) {
      peerConnection.send(message)
    } else {
      throw new Error('No connection to peer')
    }
  }

  onDisconnection (callback) {
    return this.emitter.on('disconnection', callback)
  }

  onReceive (callback) {
    return this.emitter.on('receive', callback)
  }

  onError (callback) {
    return this.emitter.on('error', callback)
  }

  isConnectedToPeer (peerId) {
    const peerConnection = this.peerConnectionsById.get(peerId)
    return peerConnection ? (peerConnection.state === 'connected') : false
  }

  getPeerIdentity (peerId) {
    return this.peerIdentitiesById.get(peerId)
  }

  didReceiveSignal (message) {
    const {senderId, senderIdentity} = message
    if (senderIdentity) this.peerIdentitiesById.set(senderId, senderIdentity)
    const peerConnection = this.getPeerConnection(senderId)
    peerConnection.signalingProvider.receiveMessage(message)
  }

  didDisconnect (peerId) {
    this.peerConnectionsById.delete(peerId)
    this.emitter.emit('disconnection', {peerId})
  }

  didReceiveMessage (event) {
    this.emitter.emit('receive', event)
  }

  peerConnectionDidError ({peerId, event}) {
    this.didDisconnect(peerId)
    this.emitter.emit('error', event)
  }

  getPeerConnection (peerId) {
    let peerConnection = this.peerConnectionsById.get(peerId)
    if (!peerConnection) {
      peerConnection = new PeerConnection({
        localPeerId: this.peerId,
        remotePeerId: peerId,
        fragmentSize: this.fragmentSize,
        iceServers: this.iceServers,
        connectionTimeout: this.connectionTimeout,
        didReceiveMessage: this.didReceiveMessage.bind(this),
        didDisconnect: this.didDisconnect.bind(this),
        didError: this.peerConnectionDidError.bind(this),
        signalingProvider: new PubSubSignalingProvider({
          localPeerId: this.peerId,
          remotePeerId: peerId,
          authTokenProvider: this.authTokenProvider,
          restGateway: this.restGateway,
          testEpoch: this.testEpoch
        })
      })
      this.peerConnectionsById.set(peerId, peerConnection)
    }
    return peerConnection
  }
}
