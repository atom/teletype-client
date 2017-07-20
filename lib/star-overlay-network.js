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

  async connectTo (hubId) {
    assert(!this.isHub, 'The hub should only receive connections')
    assert(!this.hubId, 'Can connect to hub only once')
    this.hubId = hubId
    await this.peerPool.connectTo(this.hubId)

    const starConnection = new NetworkMessage.StarConnection()
    const networkMessage = new NetworkMessage()
    networkMessage.setStarConnection(starConnection)
    networkMessage.setNetworkId(this.id)

    this.peerPool.send(this.hubId, networkMessage.serializeBinary())
  }

  disconnect () {
    if (this.isHub) {
      const connectionEcho = new NetworkMessage.StarConnectionEcho()
      connectionEcho.setStatus('leave')
      connectionEcho.setPeerId(this.getPeerId())
      const echoNetworkMessage = new NetworkMessage()
      echoNetworkMessage.setNetworkId(this.id)
      echoNetworkMessage.setStarConnectionEcho(connectionEcho)
      this.forwardBroadcast(this.getPeerId(), echoNetworkMessage.serializeBinary())

      this.spokes.clear()
    } else {
      const starDisconnection = new NetworkMessage.StarDisconnection()
      const networkMessage = new NetworkMessage()
      networkMessage.setStarDisconnection(starDisconnection)
      networkMessage.setNetworkId(this.id)

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
      this.receiveConnection(senderId)
    } else if (networkMessage.hasStarConnectionAck()) {
      this.receiveConnectionAck(networkMessage.getStarConnectionAck())
    } else if (networkMessage.hasStarDisconnection()) {
      this.receiveDisconnection(senderId)
    } else if (networkMessage.hasStarConnectionEcho()) {
      this.receiveConnectionEcho(networkMessage.getStarConnectionEcho())
    } else if (networkMessage.hasStarUnicast()) {
      this.receiveUnicast(message, networkMessage.getStarUnicast())
    } else if (networkMessage.hasStarBroadcast()) {
      this.receiveBroadcast(message, networkMessage.getStarBroadcast())
    }
  }

  receiveConnection (senderId) {
    assert(this.isHub, 'Can only receive the connections at the hub')

    const connectionAck = new NetworkMessage.StarConnectionAck()
    connectionAck.setMemberIdsList(Array.from(this.members))
    const ackNetworkMessage = new NetworkMessage()
    ackNetworkMessage.setNetworkId(this.id)
    ackNetworkMessage.setStarConnectionAck(connectionAck)
    this.peerPool.send(senderId, ackNetworkMessage.serializeBinary())

    const connectionEcho = new NetworkMessage.StarConnectionEcho()
    connectionEcho.setStatus('join')
    connectionEcho.setPeerId(senderId)
    const echoNetworkMessage = new NetworkMessage()
    echoNetworkMessage.setNetworkId(this.id)
    echoNetworkMessage.setStarConnectionEcho(connectionEcho)
    this.forwardBroadcast(senderId, echoNetworkMessage.serializeBinary())

    this.spokes.add(senderId)
    this.members.add(senderId)
    this.emitter.emit('join', {peerId: senderId})
  }

  receiveConnectionAck (connectionAckMessage) {
    assert(!this.isHub, 'Connection acknowledgments cannot be sent to the hub')
    const memberIds = connectionAckMessage.getMemberIdsList()
    for (let i = 0; i < memberIds.length; i++) {
      this.members.add(memberIds[i])
    }
  }

  receiveDisconnection (senderId) {
    assert(this.isHub, 'Can only receive disconnections at the hub')
    this.members.delete(senderId)
    this.spokes.delete(senderId)

    const connectionEcho = new NetworkMessage.StarConnectionEcho()
    connectionEcho.setStatus('leave')
    connectionEcho.setPeerId(senderId)
    const echoNetworkMessage = new NetworkMessage()
    echoNetworkMessage.setNetworkId(this.id)
    echoNetworkMessage.setStarConnectionEcho(connectionEcho)
    this.forwardBroadcast(senderId, echoNetworkMessage.serializeBinary())

    this.emitter.emit('leave', {peerId: senderId})
  }

  receiveConnectionEcho (connectionEchoMessage) {
    assert(!this.isHub, 'Connection echoes cannot be sent to the hub')

    const peerId = connectionEchoMessage.getPeerId()
    const status = connectionEchoMessage.getStatus()
    switch (status) {
      case 'join':
        this.members.add(peerId)
        this.emitter.emit('join', {peerId})
        break;
      case 'leave':
        if (peerId === this.hubId) {
          this.members = new Set([this.getPeerId()])
        } else {
          this.members.delete(peerId)
        }
        this.emitter.emit('leave', {peerId})
        break
      default:
        throw new Error('Unsupported status ' + status + ' for peer ' + peerId)
    }
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
