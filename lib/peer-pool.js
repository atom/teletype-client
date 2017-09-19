const assert = require('assert')
const {Emitter} = require('event-kit')
const PeerConnection = require('./peer-connection')
const PubSubSignalingProvider = require('./pub-sub-signaling-provider')
const Errors = require('./errors')

module.exports =
class PeerPool {
  constructor ({peerId, restGateway, pubSubGateway, fragmentSize, connectionTimeout, testEpoch}) {
    this.peerId = peerId
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.fragmentSize = fragmentSize
    this.connectionTimeout = connectionTimeout || 5000
    this.testEpoch = testEpoch
    this.emitter = new Emitter()
    this.peerConnectionsById = new Map()
  }

  initialize () {
    return Promise.all([
      this.fetchICEServers(),
      this.waitForIncomingSignals()
    ])
  }

  async fetchICEServers () {
    const {body: iceServers, ok} = await this.restGateway.get(`/ice-servers`)
    assert(Array.isArray(iceServers), 'ICE servers must be an Array')
    this.iceServers = iceServers
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

  isConnectedToPeer (peerId) {
    const peerConnection = this.peerConnectionsById.get(peerId)
    return peerConnection ? (peerConnection.state === 'connected') : false
  }

  didReceiveSignal (message) {
    const peerConnection = this.getPeerConnection(message.senderId)
    peerConnection.signalingProvider.receiveMessage(message)
  }

  didDisconnect (peerId) {
    this.peerConnectionsById.delete(peerId)
    this.emitter.emit('disconnection', {peerId})
  }

  didReceiveMessage (event) {
    this.emitter.emit('receive', event)
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
