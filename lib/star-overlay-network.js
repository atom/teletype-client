const assert = require('assert')
const {CompositeDisposable, Emitter} = require('event-kit')
const {NetworkMessage} = require('./real-time_pb')

module.exports =
class StarOverlayNetwork {
  constructor ({id, peerPool, isHub}) {
    this.id = id
    this.peerPool = peerPool
    this.isHub = isHub
    if (this.isHub) this.spokes = new Set()
    this.members = new Set([this.getPeerId()])
    this.trackDataByTrackId = new Map()
    this.emitter = new Emitter()

    this.subscriptions = new CompositeDisposable(
      peerPool.onDisconnection(this.didLoseConnectionToPeer.bind(this)),
      peerPool.onReceive(this.receive.bind(this)),
      peerPool.onTrack(this.handleTrack.bind(this))
    )
  }

  dispose () {
    this.subscriptions.dispose()
    this.disconnect()
  }

  async connectTo (hubId) {
    assert(!this.isHub, 'The hub should only receive connections')
    assert(!this.hubId, 'Can connect to hub only once')

    this.hubId = hubId
    await this.peerPool.connectTo(this.hubId)

    const starConnection = new NetworkMessage.StarConnection()
    starConnection.setSenderId(this.getPeerId())
    const networkMessage = new NetworkMessage()
    networkMessage.setStarConnection(starConnection)
    networkMessage.setNetworkId(this.id)
    this.peerPool.send(this.hubId, networkMessage.serializeBinary())

    return new Promise((resolve) => this.resolveConnectionPromise = resolve)
  }

  disconnect () {
    if (!this.connected) return

    const starDisconnection = new NetworkMessage.StarDisconnection()
    starDisconnection.setSenderId(this.getPeerId())
    starDisconnection.setConnectionLost(false)
    const networkMessage = new NetworkMessage()
    networkMessage.setStarDisconnection(starDisconnection)
    networkMessage.setNetworkId(this.id)

    if (this.isHub) {
      this.forwardBroadcast(this.getPeerId(), networkMessage.serializeBinary())
      this.spokes.clear()
    } else {
      this.peerPool.send(this.hubId, networkMessage.serializeBinary())
      this.hubId = null
    }

    this.members = new Set([this.getPeerId()])
    this.connected = false
  }

  unicast (recipientId, message) {
    if (!(message instanceof Buffer)) {
      message = Buffer.from(message)
    }

    const starUnicast = new NetworkMessage.StarUnicast()
    starUnicast.setSenderId(this.peerPool.peerId)
    starUnicast.setRecipientId(recipientId)
    starUnicast.setBody(message)
    const networkMessage = new NetworkMessage()
    networkMessage.setStarUnicast(starUnicast)
    networkMessage.setNetworkId(this.id)
    const rawNetworkMessage = networkMessage.serializeBinary()

    if (this.isHub) {
      this.forwardUnicast(recipientId, rawNetworkMessage)
    } else {
      this.peerPool.send(this.hubId, rawNetworkMessage)
    }
  }

  broadcast (message) {
    if (!(message instanceof Buffer)) {
      message = Buffer.from(message)
    }

    const starBroadcast = new NetworkMessage.StarBroadcast()
    starBroadcast.setSenderId(this.peerPool.peerId)
    starBroadcast.setBody(message)
    const networkMessage = new NetworkMessage()
    networkMessage.setStarBroadcast(starBroadcast)
    networkMessage.setNetworkId(this.id)
    const rawNetworkMessage = networkMessage.serializeBinary()

    if (this.isHub) {
      this.forwardBroadcast(this.peerPool.peerId, rawNetworkMessage)
    } else {
      this.peerPool.send(this.hubId, rawNetworkMessage)
    }
  }

  broadcastTrack (metadata, track, stream) {
    const starTrackBroadcast = new NetworkMessage.StarTrackBroadcast()
    starTrackBroadcast.setSenderId(this.peerPool.peerId)
    starTrackBroadcast.setTrackId(track.id)
    starTrackBroadcast.setMetadata(Buffer.from(metadata))
    const networkMessage = new NetworkMessage()
    networkMessage.setStarTrackBroadcast(starTrackBroadcast)
    networkMessage.setNetworkId(this.id)
    const rawNetworkMessage = networkMessage.serializeBinary()

    if (this.isHub) {
      this.trackDataByTrackId.set(track.id, {
        senderId: this.peerPool.peerId,
        metadata, track, stream,
        rawNetworkMessage
      })

      this.spokes.forEach((peerId) => {
        this.peerPool.send(peerId, rawNetworkMessage)
        this.peerPool.addTrack(peerId, track, stream)
      })
    } else {
      this.peerPool.send(this.hubId, rawNetworkMessage)
      this.peerPool.addTrack(this.hubId, track, stream)
    }
  }

  onPeerJoin (callback) {
    return this.emitter.on('join', callback)
  }

  onPeerLeave (callback) {
    return this.emitter.on('leave', callback)
  }

  onReceive (callback) {
    return this.emitter.on('receive', callback)
  }

  onTrack (callback) {
    return this.emitter.on('track', callback)
  }

  getMembers () {
    return this.members
  }

  getPeerId () {
    return this.peerPool.peerId
  }

  receiveDisconnection (rawMessage, disconnectionMessage) {
    const peerId = disconnectionMessage.getSenderId()
    if (this.isHub) {
      this.spokes.delete(peerId)
      this.forwardBroadcast(peerId, rawMessage)
    }
    this.handleDisconnection(peerId, disconnectionMessage.getConnectionLost())
  }

  didLoseConnectionToPeer ({peerId}) {
    if (this.isHub) {
      this.spokes.delete(peerId)

      const starDisconnection = new NetworkMessage.StarDisconnection()
      starDisconnection.setSenderId(peerId)
      starDisconnection.setConnectionLost(true)
      const networkMessage = new NetworkMessage()
      networkMessage.setStarDisconnection(starDisconnection)
      networkMessage.setNetworkId(this.id)
      this.forwardBroadcast(peerId, networkMessage.serializeBinary())
    }

    this.handleDisconnection(peerId, true)
  }

  handleDisconnection (peerId, connectionLost) {
    if (peerId === this.hubId) {
      this.hubId = null
      this.connected = false
      this.members = new Set([this.getPeerId()])
    } else {
      this.members.delete(peerId)
    }

    this.emitter.emit('leave', {peerId, connectionLost})
  }

  receive ({senderId, message}) {
    const networkMessage = NetworkMessage.deserializeBinary(message)
    if (networkMessage.getNetworkId() !== this.id) return

    if (networkMessage.hasStarConnection()) {
      this.receiveConnection(message, networkMessage.getStarConnection())
    } else if (networkMessage.hasStarConnectionAck()) {
      this.receiveConnectionAck(networkMessage.getStarConnectionAck())
    } else if (networkMessage.hasStarDisconnection()) {
      this.receiveDisconnection(message, networkMessage.getStarDisconnection())
    } else if (networkMessage.hasStarUnicast()) {
      this.receiveUnicast(message, networkMessage.getStarUnicast())
    } else if (networkMessage.hasStarBroadcast()) {
      this.receiveBroadcast(message, networkMessage.getStarBroadcast())
    } else if (networkMessage.hasStarTrackBroadcast()) {
      this.receiveTrackBroadcast(message, networkMessage.getStarTrackBroadcast())
    }
  }

  receiveConnection (rawMessage, connectionMessage) {
    const senderId = connectionMessage.getSenderId()
    if (this.isHub) {
      this.connected = true
      this.spokes.add(senderId)

      const connectionAck = new NetworkMessage.StarConnectionAck()
      connectionAck.setMemberIdsList(Array.from(this.members))
      const ackNetworkMessage = new NetworkMessage()
      ackNetworkMessage.setNetworkId(this.id)
      ackNetworkMessage.setStarConnectionAck(connectionAck)
      this.peerPool.send(senderId, ackNetworkMessage.serializeBinary())

      this.trackDataByTrackId.forEach(({track, stream, rawNetworkMessage}) => {
        this.peerPool.send(senderId, rawNetworkMessage)
        this.peerPool.addTrack(senderId, track, stream)
      })

      this.forwardBroadcast(senderId, rawMessage)
    }

    this.members.add(senderId)
    this.emitter.emit('join', {peerId: senderId})
  }

  receiveConnectionAck (connectionAckMessage) {
    assert(!this.isHub, 'Connection acknowledgments cannot be sent to the hub')
    const memberIds = connectionAckMessage.getMemberIdsList()
    for (let i = 0; i < memberIds.length; i++) {
      this.members.add(memberIds[i])
    }

    this.resolveConnectionPromise()
    this.resolveConnectionPromise = null
    this.connected = true
  }

  receiveUnicast (rawMessage, unicastMessage) {
    const recipientId = unicastMessage.getRecipientId()
    if (recipientId === this.peerPool.peerId) {
      this.emitter.emit('receive', {
        senderId: unicastMessage.getSenderId(),
        message: Buffer.from(unicastMessage.getBody())
      })
    } else if (this.isHub) {
      this.forwardUnicast(recipientId, rawMessage)
    } else {
      throw new Error('Received a unicast not intended for this peer')
    }
  }

  receiveBroadcast (rawMessage, broadcastMessage) {
    const senderId = broadcastMessage.getSenderId()
    if (this.isHub) this.forwardBroadcast(senderId, rawMessage)
    this.emitter.emit('receive', {
      senderId,
      message: Buffer.from(broadcastMessage.getBody())
    })
  }

  receiveTrackBroadcast (rawNetworkMessage, trackBroadcast) {
    const senderId = trackBroadcast.getSenderId()
    const trackId = trackBroadcast.getTrackId()
    const metadata = Buffer.from(trackBroadcast.getMetadata())
    this.trackDataByTrackId.set(trackId, {senderId, metadata, rawNetworkMessage})

    if (this.isHub) {
      this.forwardBroadcast(senderId, rawNetworkMessage)
    }
  }

  forwardUnicast (recipientId, rawMessage) {
    if (this.spokes.has(recipientId)) {
      this.peerPool.send(recipientId, rawMessage)
    }
  }

  forwardBroadcast (senderId, rawMessage) {
    this.spokes.forEach((peerId) => {
      if (peerId !== senderId) {
        this.peerPool.send(peerId, rawMessage)
      }
    })
  }

  handleTrack ({track}) {
    const data = this.trackDataByTrackId.get(track.id)
    if (data) {
      const {senderId, metadata} = data
      this.emitter.emit('track', {senderId, metadata, track})
      if (this.isHub) {
        const stream = new MediaStream([track])
        data.track = track
        data.stream = stream
        this.spokes.forEach((peerId) => {
          this.peerPool.addTrack(peerId, track, stream)
        })
      }
    }
  }
}
