const assert = require('assert')
const {Emitter} = require('event-kit')
const {NetworkMessage} = require('./real-time_pb')

module.exports =
class StarOverlayNetwork {
  constructor ({id, peerPool, isHub}) {
    this.id = id
    this.peerPool = peerPool
    this.isHub = isHub
    if (this.isHub) this.spokes = new Set()
    this.members = new Set([this.getPeerId()])
    this.emitter = new Emitter()

    this.subscription = peerPool.onReceive(this.receive.bind(this))
  }

  dispose () {
    this.subscription.dispose()
  }

  connectTo (hubId) {
    assert(!this.isHub, 'The hub should only receive connections')
    assert(!this.hubId, 'Can connect to hub only once')
    return new Promise(async (resolve) => {
      this.resolveConnectionPromise = resolve

      this.hubId = hubId
      await this.peerPool.connectTo(this.hubId)

      const starConnection = new NetworkMessage.StarConnection()
      starConnection.setSenderId(this.getPeerId())
      const networkMessage = new NetworkMessage()
      networkMessage.setStarConnection(starConnection)
      networkMessage.setNetworkId(this.id)

      this.peerPool.send(this.hubId, networkMessage.serializeBinary())
    })
  }

  disconnect () {
    const starDisconnection = new NetworkMessage.StarDisconnection()
    starDisconnection.setSenderId(this.getPeerId())
    const networkMessage = new NetworkMessage()
    networkMessage.setStarDisconnection(starDisconnection)
    networkMessage.setNetworkId(this.id)

    if (this.isHub) {
      this.forwardBroadcast(this.getPeerId(), networkMessage.serializeBinary())
      this.spokes.clear()
    } else {
      this.peerPool.send(this.hubId, networkMessage.serializeBinary())
    }

    this.members = new Set([this.getPeerId()])
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

  onJoin (callback) {
    return this.emitter.on('join', callback)
  }

  onLeave (callback) {
    return this.emitter.on('leave', callback)
  }

  onReceive (callback) {
    return this.emitter.on('receive', callback)
  }

  getMembers () {
    return this.members
  }

  getPeerId () {
    return this.peerPool.peerId
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
    }
  }

  receiveConnection (rawMessage, connectionMessage) {
    const senderId = connectionMessage.getSenderId()
    if (this.isHub) {
      this.spokes.add(senderId)

      const connectionAck = new NetworkMessage.StarConnectionAck()
      connectionAck.setMemberIdsList(Array.from(this.members))
      const ackNetworkMessage = new NetworkMessage()
      ackNetworkMessage.setNetworkId(this.id)
      ackNetworkMessage.setStarConnectionAck(connectionAck)
      this.peerPool.send(senderId, ackNetworkMessage.serializeBinary())

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
  }

  receiveDisconnection (rawMessage, disconnectionMessage) {
    const senderId = disconnectionMessage.getSenderId()
    if (this.isHub) {
      this.spokes.delete(senderId)
      this.forwardBroadcast(senderId, rawMessage)
    }

    if (senderId === this.hubId) {
      this.members = new Set([this.getPeerId()])
    } else {
      this.members.delete(senderId)
    }

    this.emitter.emit('leave', {peerId: senderId})
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
}
