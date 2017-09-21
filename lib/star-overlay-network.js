const assert = require('assert')
const {CompositeDisposable, Emitter} = require('event-kit')
const {NetworkMessage} = require('./real-time_pb')
const Errors = require('./errors')
const convertToProtobufCompatibleBuffer = require('./convert-to-protobuf-compatible-buffer')

module.exports =
class StarOverlayNetwork {
  constructor ({id, peerPool, isHub, connectionTimeout}) {
    this.id = id
    this.peerPool = peerPool
    this.isHub = isHub
    if (this.isHub) this.spokes = new Set()
    this.members = new Set([this.getPeerId()])
    this.emitter = new Emitter()
    this.state = 'disconnected'
    this.connectionTimeout = connectionTimeout || 5000

    this.subscriptions = new CompositeDisposable(
      peerPool.onDisconnection(this.didLoseConnectionToPeer.bind(this)),
      peerPool.onReceive(this.receive.bind(this))
    )
  }

  dispose () {
    this.subscriptions.dispose()
    this.disconnect()
  }

  async connectTo (hubId) {
    assert(!this.isHub, 'The hub should only receive connections')
    assert(!this.hubId, 'Can connect to hub only once')

    this.state = 'connecting'
    this.hubId = hubId
    await this.peerPool.connectTo(this.hubId)

    const starConnection = new NetworkMessage.StarConnection()
    starConnection.setSenderId(this.getPeerId())
    const networkMessage = new NetworkMessage()
    networkMessage.setStarConnection(starConnection)
    networkMessage.setNetworkId(this.id)
    this.send(this.hubId, networkMessage.serializeBinary())

    const timeoutError = new Errors.NetworkConnectionError('Connecting to the portal network timed out')
    return new Promise((resolve, reject) => {
      this.resolveConnectionPromise = resolve
      setTimeout(() => {
        if (this.state === 'connecting') {
          this.state = 'timeout'
          reject(timeoutError)
        }
      }, this.connectionTimeout)
    })
  }

  disconnect () {
    if (this.state !== 'connected') return

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
      this.send(this.hubId, networkMessage.serializeBinary())
      this.hubId = null
    }

    this.members = new Set([this.getPeerId()])
    this.state = 'disconnected'
  }

  unicast (recipientId, message) {
    message = convertToProtobufCompatibleBuffer(message)

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
      this.send(this.hubId, rawNetworkMessage)
    }
  }

  broadcast (message) {
    message = convertToProtobufCompatibleBuffer(message)

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
      this.send(this.hubId, rawNetworkMessage)
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
      this.state = 'disconnected'
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
    }
  }

  receiveConnection (rawMessage, connectionMessage) {
    const senderId = connectionMessage.getSenderId()
    if (this.isHub) {
      this.state = 'connected'
      this.spokes.add(senderId)

      const connectionAck = new NetworkMessage.StarConnectionAck()
      connectionAck.setMemberIdsList(Array.from(this.members))
      const ackNetworkMessage = new NetworkMessage()
      ackNetworkMessage.setNetworkId(this.id)
      ackNetworkMessage.setStarConnectionAck(connectionAck)
      this.send(senderId, ackNetworkMessage.serializeBinary())
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

    if (this.state === 'timeout') {
      this.state = 'connected'
      this.disconnect()
    } else {
      this.state = 'connected'
      this.resolveConnectionPromise()
    }

    this.resolveConnectionPromise = null
  }

  receiveUnicast (rawMessage, unicastMessage) {
    const recipientId = unicastMessage.getRecipientId()
    if (recipientId === this.peerPool.peerId) {
      this.emitter.emit('receive', {
        senderId: unicastMessage.getSenderId(),
        message: convertToProtobufCompatibleBuffer(unicastMessage.getBody())
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
      message: convertToProtobufCompatibleBuffer(broadcastMessage.getBody())
    })
  }

  forwardUnicast (recipientId, rawMessage) {
    if (this.spokes.has(recipientId)) {
      this.send(recipientId, rawMessage)
    }
  }

  forwardBroadcast (senderId, rawMessage) {
    this.spokes.forEach((peerId) => {
      if (peerId !== senderId) {
        this.send(peerId, rawMessage)
      }
    })
  }

  send (peerId, message) {
    if (this.peerPool.isConnectedToPeer(peerId) ) {
      this.peerPool.send(peerId, message)
    }
  }
}
