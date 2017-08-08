const {Emitter} = require('event-kit')
const PeerConnection = require('./peer-connection')

module.exports =
class PeerPool {
  constructor ({peerId, restGateway, pubSubGateway, fragmentSize}) {
    this.peerId = peerId
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.fragmentSize = fragmentSize
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
    this.iceServers = await this.restGateway.get(`/ice-servers`)
  }

  waitForIncomingSignals () {
    return this.pubSubGateway.subscribe(`/peers/${this.peerId}`, 'signal', this.didReceiveSignal.bind(this))
  }

  connectTo (peerId) {
    return this.getPeerConnection(peerId).connect()
  }

  getConnectedPromise (peerId) {
    return this.getPeerConnection(peerId).getConnectedPromise()
  }

  getNextNegotiationCompletedPromise (peerId) {
    if (peerId == null) throw new Error('You must call getNextNegotiationCompletedPromise with a target peer id')
    return this.getPeerConnection(peerId).getNextNegotiationCompletedPromise()
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

  addMediaTrack (peerId, track, stream) {
    const peerConnection = this.getPeerConnection(peerId)
    return peerConnection.addMediaTrack(track, stream)
  }

  onDisconnection (callback) {
    return this.emitter.on('disconnection', callback)
  }

  onReceive (callback) {
    return this.emitter.on('receive', callback)
  }

  onMediaTrack (callback) {
    return this.emitter.on('media-track', callback)
  }

  isConnectedToPeer (peerId) {
    const peerConnection = this.peerConnectionsById.get(peerId)
    return peerConnection ? peerConnection.connected : false
  }

  didReceiveSignal ({senderId, signal}) {
    const peerConnection = this.getPeerConnection(senderId, false)
    peerConnection.receiveSignal(signal)
  }

  didDisconnect (peerId) {
    this.peerConnectionsById.delete(peerId)
    this.emitter.emit('disconnection', {peerId})
  }

  didReceiveMessage (event) {
    this.emitter.emit('receive', event)
  }

  didReceiveMediaTrack (event) {
    this.emitter.emit('media-track', event)
  }

  getPeerConnection (peerId) {
    let peerConnection = this.peerConnectionsById.get(peerId)
    if (!peerConnection) {
      peerConnection = new PeerConnection({
        peerId,
        fragmentSize: this.fragmentSize,
        pool: this,
        restGateway: this.restGateway,
        iceServers: this.iceServers
      })
      this.peerConnectionsById.set(peerId, peerConnection)
    }
    return peerConnection
  }
}
