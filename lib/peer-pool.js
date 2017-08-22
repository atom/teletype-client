const {Emitter} = require('event-kit')
const PeerConnection = require('./peer-connection')

module.exports =
class PeerPool {
  constructor ({peerId, oauthToken, restGateway, pubSubGateway, fragmentSize}) {
    this.peerId = peerId
    this.oauthToken = oauthToken
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.fragmentSize = fragmentSize
    this.emitter = new Emitter()
    this.peerConnectionsById = new Map()
    this.usersByPeerId = new Map()
  }

  initialize () {
    return Promise.all([
      this.fetchICEServers(),
      this.waitForIncomingSignals(),
      this.authenticate()
    ])
  }

  async fetchICEServers () {
    this.iceServers = await this.restGateway.get(`/ice-servers`)
  }

  waitForIncomingSignals () {
    return this.pubSubGateway.subscribe(`/peers/${this.peerId}`, 'signal', this.didReceiveSignal.bind(this))
  }

  async authenticate () {
    const user = await this.restGateway.get('/user', {oauthToken: this.oauthToken})
    this.usersByPeerId.set(this.peerId, user)
  }

  connectTo (peerId) {
    const peerConnection = this.getPeerConnection(peerId, true)
    return peerConnection.getConnectPromise()
  }

  disconnect () {
    this.peerConnectionsById.forEach((peerConnection, peerId) => {
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
    return peerConnection ? peerConnection.connected : false
  }

  getUser (peerId) {
    return this.usersByPeerId.get(peerId)
  }

  didReceiveSignal ({senderId, user, data, sequenceNumber}) {
    const peerConnection = this.getPeerConnection(senderId, false)
    peerConnection.receiveSignal(sequenceNumber, data)
    this.usersByPeerId.set(senderId, user)
  }

  didDisconnect ({peerId}) {
    this.peerConnectionsById.delete(peerId)
    this.usersByPeerId.delete(peerId)
    this.emitter.emit('disconnection', {peerId})
  }

  didReceiveMessage (event) {
    this.emitter.emit('receive', event)
  }

  getPeerConnection (peerId, initiator) {
    let peerConnection = this.peerConnectionsById.get(peerId)
    if (!peerConnection) {
      peerConnection = new PeerConnection({
        peerId,
        initiator,
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
