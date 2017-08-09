const {Emitter} = require('event-kit')
const PeerConnection = require('./peer-connection')

module.exports =
class PeerPool {
  constructor ({peerId, restGateway, pubSubGateway, fragmentSize, testEpoch}) {
    this.peerId = peerId
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.fragmentSize = fragmentSize
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

  addTrack (peerId, track, stream) {
    const peerConnection = this.getPeerConnection(peerId)
    return peerConnection.addTrack(track, stream)
  }

  onDisconnection (callback) {
    return this.emitter.on('disconnection', callback)
  }

  onReceive (callback) {
    return this.emitter.on('receive', callback)
  }

  onTrack (callback) {
    return this.emitter.on('media-track', callback)
  }

  isConnectedToPeer (peerId) {
    const peerConnection = this.peerConnectionsById.get(peerId)
    return peerConnection ? peerConnection.connected : false
  }

  didReceiveSignal ({senderId, signal, testEpoch}) {
    if (testEpoch != null && testEpoch !== this.testEpoch) return
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

  didReceiveTrack (event) {
    this.emitter.emit('media-track', event)
  }

  getPeerConnection (peerId) {
    let peerConnection = this.peerConnectionsById.get(peerId)
    if (!peerConnection) {
      peerConnection = new PeerConnection({
        ownerId: this.peerId,
        peerId,
        fragmentSize: this.fragmentSize,
        pool: this,
        restGateway: this.restGateway,
        iceServers: this.iceServers,
        testEpoch: this.testEpoch
      })
      this.peerConnectionsById.set(peerId, peerConnection)
    }
    return peerConnection
  }
}
