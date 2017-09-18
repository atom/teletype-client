const {Emitter} = require('event-kit')
const PeerConnection = require('./peer-connection')
const PubSubSignalingProvider = require('./pub-sub-signaling-provider')

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
      this.getICEServers(),
      this.waitForIncomingSignals()
    ])
  }

  async getICEServers () {
    if (this.iceServers == null) {
      const response = await this.restGateway.get(`/ice-servers`)
      this.iceServers = response.body

      const expirationTimestamp = response.headers.get('Expires')
      if (expirationTimestamp) {
        const expirationDate = new Date(expirationTimestamp)
        const ttl = expirationDate - Date.now()
        // TODO Clear this timeout when we destroy a PeerPool object
        setTimeout(() => {this.iceServers = null}, ttl)
      }
    }
    return this.iceServers
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
