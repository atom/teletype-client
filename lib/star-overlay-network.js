const assert = require('assert')
const {CompositeDisposable, Emitter} = require('event-kit')
const {NetworkMember, NetworkMessage} = require('./real-time_pb')
const convertToProtobufCompatibleBuffer = require('./convert-to-protobuf-compatible-buffer')

module.exports =
class StarOverlayNetwork {
  constructor ({id, peerPool, isHub}) {
    this.id = id
    this.peerPool = peerPool
    this.isHub = isHub
    if (this.isHub) this.spokes = new Set()
    this.members = new Map() // TODO Rename `members` to something like "membersByPeerId"
    this.members.set(this.getPeerId(), this.peerPool.getUser(this.getPeerId())) // TODO Consider moving this to a fn, since same this logic exists in multiple places in this class
    this.emitter = new Emitter()

    this.subscriptions = new CompositeDisposable(
      peerPool.onDisconnection(this.didLoseConnectionToPeer.bind(this)),
      peerPool.onReceive(this.receive.bind(this))
    )
  }

  dispose () {
    this.subscriptions.dispose()
    this.disconnect()
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

    this.members.clear()
    this.members.set(this.getPeerId(), {
      peerId: this.getPeerId(),
      username: this.peerPool.getUser(this.getPeerId()).username
    })
    this.connected = false
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
      this.peerPool.send(this.hubId, rawNetworkMessage)
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
      this.peerPool.send(this.hubId, rawNetworkMessage)
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
    const members = new Set()
    this.members.forEach((user, peerId) => {
      members.add({peerId, username: user.username})
    })
    return members
  }

  getPeerId () {
    return this.peerPool.peerId
  }

  receive ({senderId, message}) {
    const networkMessage = NetworkMessage.deserializeBinary(message)
    if (networkMessage.getNetworkId() !== this.id) return

    if (networkMessage.hasStarConnection()) {
      this.receiveConnection(message, networkMessage.getStarConnection())
    } else if (networkMessage.hasStarJoinResponse()) {
      this.receiveJoinResponse(networkMessage.getStarJoinResponse())
    } else if (networkMessage.hasStarJoinNotification()) {
      this.receiveJoinNotification(networkMessage.getStarJoinNotification())
    } else if (networkMessage.hasStarDisconnection()) {
      this.receiveDisconnection(message, networkMessage.getStarDisconnection())
    } else if (networkMessage.hasStarUnicast()) {
      this.receiveUnicast(message, networkMessage.getStarUnicast())
    } else if (networkMessage.hasStarBroadcast()) {
      this.receiveBroadcast(message, networkMessage.getStarBroadcast())
    }
  }

  receiveConnection (rawMessage, connectionMessage) {
    assert(this.isHub, 'Join requests can only be sent to the hub')

    const senderId = connectionMessage.getSenderId()

    this.connected = true
    this.spokes.add(senderId)

    const networkMembers = []
    this.getMembers().forEach((member) => {
      const networkMember = new NetworkMember()
      networkMember.setPeerId(member.peerId)
      networkMember.setUsername(member.username)
      networkMembers.push(networkMember)
    })

    const joinResponse = new NetworkMessage.StarJoinResponse()
    joinResponse.setMembersList(networkMembers)
    const ackNetworkMessage = new NetworkMessage()
    ackNetworkMessage.setNetworkId(this.id)
    ackNetworkMessage.setStarJoinResponse(joinResponse)
    this.peerPool.send(senderId, ackNetworkMessage.serializeBinary())

    const joinNotification = new NetworkMessage.StarJoinNotification()
    const networkMember = new NetworkMember()
    networkMember.setPeerId(senderId)
    networkMember.setUsername(this.peerPool.getUser(senderId).username)
    joinNotification.setMember(networkMember)
    const starJoinNetworkMessage = new NetworkMessage()
    starJoinNetworkMessage.setNetworkId(this.id)
    starJoinNetworkMessage.setStarJoinNotification(joinNotification)
    this.forwardBroadcast(senderId, starJoinNetworkMessage.serializeBinary())

    this.members.set(senderId, this.peerPool.getUser(senderId))
    this.emitter.emit('join', {peerId: senderId})
  }

  receiveJoinResponse (joinResponse) {
    assert(!this.isHub, 'Join responses cannot be sent to the hub')
    const networkMembers = joinResponse.getMembersList()
    for (let i = 0; i < networkMembers.length; i++) {
      const member = networkMembers[i]
      this.members.set(member.getPeerId(), {
        peerId: member.getPeerId(),
        username: member.getUsername()
      })
    }

    this.resolveConnectionPromise()
    this.resolveConnectionPromise = null
    this.connected = true
  }

  receiveJoinNotification (joinNotification) {
    const member = joinNotification.getMember()

    this.members.set(member.getPeerId(), {
      peerId: member.getPeerId(),
      username: member.getUsername()
    })

    this.emitter.emit('join', {peerId: member.getPeerId()})
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

  receiveDisconnection (rawMessage, disconnectionMessage) {
    const peerId = disconnectionMessage.getSenderId()
    if (this.isHub) {
      this.spokes.delete(peerId)
      this.forwardBroadcast(peerId, rawMessage)
    }

    this.handleDisconnection(peerId, disconnectionMessage.getConnectionLost())
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

  handleDisconnection (peerId, connectionLost) {
    if (peerId === this.hubId) {
      this.hubId = null
      this.connected = false
      this.members.clear()
      this.members.set(this.getPeerId(), {
        peerId: this.getPeerId(),
        username: this.peerPool.getUser(this.getPeerId()).username
      })
    } else {
      this.members.delete(peerId)
    }

    this.emitter.emit('leave', {peerId, connectionLost})
  }
}
