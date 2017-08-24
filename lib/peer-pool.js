const {Emitter} = require('event-kit')
const PeerConnection = require('./peer-connection')
const PubSubSignalingProvider = require('./pub-sub-signaling-provider')

module.exports =
class PeerPool {
  constructor ({peerId, oauthToken, restGateway, pubSubGateway, fragmentSize, testEpoch}) {
    this.peerId = peerId
    this.oauthToken = oauthToken
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.fragmentSize = fragmentSize
    this.testEpoch = testEpoch
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
    return peerConnection ? peerConnection.connected : false
  }

  getUser (peerId) {
    return this.usersByPeerId.get(peerId)
  }

  didReceiveSignal (message) {
    const peerConnection = this.getPeerConnection(message.senderId)
    peerConnection.signalingProvider.receiveMessage(message)
    this.usersByPeerId.set(message.senderId, message.user)
  }

  didDisconnect (peerId) {
    this.peerConnectionsById.delete(peerId)
    this.usersByPeerId.delete(peerId)
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
        didReceiveMessage: this.didReceiveMessage.bind(this),
        didDisconnect: this.didDisconnect.bind(this),
        signalingProvider: new PubSubSignalingProvider({
          localPeerId: this.peerId,
          remotePeerId: peerId,
          oauthToken: this.oauthToken,
          restGateway: this.restGateway,
          testEpoch: this.testEpoch
        })
      })
      this.peerConnectionsById.set(peerId, peerConnection)
    }
    return peerConnection
  }
}
