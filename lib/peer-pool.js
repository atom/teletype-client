const assert = require('assert')
const {CompositeDisposable, Disposable, Emitter} = require('event-kit')
const PeerConnection = require('./peer-connection')
const PubSubSignalingProvider = require('./pub-sub-signaling-provider')
const Errors = require('./errors')

module.exports =
class PeerPool {
  constructor ({peerId, peerIdentity, restGateway, pubSubGateway, fragmentSize, connectionTimeout, testEpoch}) {
    this.peerId = peerId
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.fragmentSize = fragmentSize
    this.connectionTimeout = connectionTimeout || 5000
    this.testEpoch = testEpoch
    this.emitter = new Emitter()
    this.subscriptions = new CompositeDisposable()
    this.peerConnectionsById = new Map()
    this.peerIdentitiesById = new Map([
      [peerId, peerIdentity]
    ])
    this.disposed = false
    this.listenersCount = 0
  }

  async initialize () {
    await this.fetchICEServers()
  }

  async listen () {
    if (!this.listenPromise) {
      const timeoutError = new Errors.PubSubConnectionError('Timed out while subscribing to incoming signals')
      this.listenPromise = new Promise(async (resolve, reject) => {
        let rejected = false
        const timeoutId = window.setTimeout(() => {
          this.listenPromise = null
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
          this.subscriptions.add(subscription)
          resolve(subscription)
        }
      })
    }

    this.listenersCount++
    const subscription = await this.listenPromise
    return new Disposable(() => {
      this.listenersCount--
      if (this.listenersCount === 0) {
        this.listenPromise = null
        subscription.dispose()
      }
    })
  }

  dispose () {
    this.disposed = true
    this.subscriptions.dispose()
    this.peerIdentitiesById.clear()
    this.disconnect()
  }

  async fetchICEServers () {
    const {body: iceServers, ok} = await this.restGateway.get('/ice-servers')
    assert(Array.isArray(iceServers), 'ICE servers must be an Array')
    this.iceServers = iceServers
  }

  getLocalPeerIdentity () {
    return this.peerIdentitiesById.get(this.peerId)
  }

  async connectTo (peerId) {
    if (this.peerId === peerId) {
      throw new Errors.PeerConnectionError('Sorry. You can\'t connect to yourself this way. Maybe try meditation or a walk in the woods instead?')
    }

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
          restGateway: this.restGateway,
          testEpoch: this.testEpoch
        })
      })
      this.peerConnectionsById.set(peerId, peerConnection)
    }
    return peerConnection
  }
}
