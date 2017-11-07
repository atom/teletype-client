const assert = require('assert')
const {CompositeDisposable, Emitter} = require('event-kit')
const {NetworkMessage, PeerIdentity} = require('./teletype-client_pb')
const Errors = require('./errors')
const convertToProtobufCompatibleBuffer = require('./convert-to-protobuf-compatible-buffer')

module.exports =
class StarOverlayNetwork {
  constructor ({id, peerPool, isHub, connectionTimeout}) {
    this.id = id
    this.peerPool = peerPool
    this.isHub = isHub
    this.connectionTimeout = connectionTimeout || 5000
    this.emitter = new Emitter()
    this.memberIdentitiesById = new Map([
      [this.getPeerId(), this.peerPool.getPeerIdentity(this.getPeerId())]
    ])
    this.connectedMemberIds = new Set()
    this.resetConnectedMembers()

    if (this.isHub) {
      this.spokes = new Set()
      this.state = 'connected'
    } else {
      this.state = 'disconnected'
    }

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

    try {
      const starJoinRequest = new NetworkMessage.StarJoinRequest()
      starJoinRequest.setSenderId(this.getPeerId())
      const networkMessage = new NetworkMessage()
      networkMessage.setStarJoinRequest(starJoinRequest)
      networkMessage.setNetworkId(this.id)
      this.send(this.hubId, networkMessage.serializeBinary())
    } catch (error) {
      this.state = 'disconnected'
      this.hubId = null
      throw error
    }

    const timeoutError = new Errors.NetworkConnectionError('Connecting to the portal network timed out')
    return new Promise((resolve, reject) => {
      this.resolveConnectionPromise = resolve
      setTimeout(() => {
        if (this.state === 'connecting') {
          this.state = 'timeout'
          this.disconnect()
          reject(timeoutError)
        }
      }, this.connectionTimeout)
    })
  }

  disconnect () {
    if (this.state === 'disconnected') return

    const leaveNotificationMessage = new NetworkMessage.StarLeaveNotification()
    leaveNotificationMessage.setMemberId(this.getPeerId())
    leaveNotificationMessage.setConnectionLost(false)
    const networkMessage = new NetworkMessage()
    networkMessage.setStarLeaveNotification(leaveNotificationMessage)
    networkMessage.setNetworkId(this.id)

    if (this.isHub) {
      this.forwardBroadcast(this.getPeerId(), networkMessage.serializeBinary())
      this.spokes.clear()
    } else {
      this.send(this.hubId, networkMessage.serializeBinary())
      this.hubId = null
    }

    this.resetConnectedMembers()
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

  onMemberJoin (callback) {
    return this.emitter.on('join', callback)
  }

  onMemberLeave (callback) {
    return this.emitter.on('leave', callback)
  }

  onReceive (callback) {
    return this.emitter.on('receive', callback)
  }

  getMemberIds () {
    return Array.from(this.connectedMemberIds)
  }

  getMemberIdentity (peerId) {
    return this.memberIdentitiesById.get(peerId)
  }

  getPeerId () {
    return this.peerPool.peerId
  }

  didLoseConnectionToPeer ({peerId}) {
    if (!this.connectedMemberIds.has(peerId)) return

    if (this.isHub) {
      this.spokes.delete(peerId)

      const leaveNotificationMessage = new NetworkMessage.StarLeaveNotification()
      leaveNotificationMessage.setMemberId(peerId)
      leaveNotificationMessage.setConnectionLost(true)
      const networkMessage = new NetworkMessage()
      networkMessage.setStarLeaveNotification(leaveNotificationMessage)
      networkMessage.setNetworkId(this.id)
      this.forwardBroadcast(peerId, networkMessage.serializeBinary())
    }

    this.memberDidLeave(peerId, true)
  }

  receive ({senderId, message}) {
    if (this.state === 'disconnected') return

    const networkMessage = NetworkMessage.deserializeBinary(message)
    if (networkMessage.getNetworkId() !== this.id) return

    if (networkMessage.hasStarJoinRequest()) {
      this.receiveJoinRequest(message, networkMessage.getStarJoinRequest())
    } else if (networkMessage.hasStarJoinResponse()) {
      this.receiveJoinResponse(networkMessage.getStarJoinResponse())
    } else if (networkMessage.hasStarJoinNotification()) {
      this.receiveJoinNotification(networkMessage.getStarJoinNotification())
    } else if (networkMessage.hasStarLeaveNotification()) {
      this.receiveLeaveNotification(message, networkMessage.getStarLeaveNotification())
    } else if (networkMessage.hasStarUnicast()) {
      this.receiveUnicast(message, networkMessage.getStarUnicast())
    } else if (networkMessage.hasStarBroadcast()) {
      this.receiveBroadcast(message, networkMessage.getStarBroadcast())
    }
  }

  receiveJoinRequest (rawMessage, connectionMessage) {
    assert(this.isHub, 'Join requests should only be sent to the hub')
    const senderId = connectionMessage.getSenderId()
    const senderIdentity = this.peerPool.getPeerIdentity(senderId)

    this.state = 'connected'
    this.spokes.add(senderId)
    this.memberIdentitiesById.set(senderId, senderIdentity)
    this.connectedMemberIds.add(senderId)

    // Respond to new member
    const joinResponseMessage = new NetworkMessage.StarJoinResponse()
    const memberIdentitiesByIdMessage = joinResponseMessage.getMemberIdentitiesByIdMap()
    this.connectedMemberIds.forEach((peerId) => {
      const identity = this.getMemberIdentity(peerId)
      memberIdentitiesByIdMessage.set(peerId, serializePeerIdentity(identity))
    })
    const responseNetworkMessage = new NetworkMessage()
    responseNetworkMessage.setNetworkId(this.id)
    responseNetworkMessage.setStarJoinResponse(joinResponseMessage)
    this.send(senderId, responseNetworkMessage.serializeBinary())

    // Notify other spokes of new member
    const joinNotificationMessage = new NetworkMessage.StarJoinNotification()
    joinNotificationMessage.setMemberId(senderId)
    joinNotificationMessage.setMemberIdentity(serializePeerIdentity(senderIdentity))
    const notificationNetworkMessage = new NetworkMessage()
    notificationNetworkMessage.setNetworkId(this.id)
    notificationNetworkMessage.setStarJoinNotification(joinNotificationMessage)
    this.forwardBroadcast(senderId, notificationNetworkMessage.serializeBinary())

    this.emitter.emit('join', {peerId: senderId})
  }

  receiveJoinResponse (joinResponseMessage) {
    assert(!this.isHub, 'Connection responses cannot be sent to the hub')
    joinResponseMessage.getMemberIdentitiesByIdMap().forEach((identityMessage, peerId) => {
      this.memberIdentitiesById.set(peerId, deserializePeerIdentity(identityMessage))
      this.connectedMemberIds.add(peerId)
    })

    this.state = 'connected'
    this.resolveConnectionPromise()
    this.resolveConnectionPromise = null
  }

  receiveJoinNotification (joinNotificationMessage) {
    const memberId = joinNotificationMessage.getMemberId()
    const memberIdentity = deserializePeerIdentity(joinNotificationMessage.getMemberIdentity())
    this.memberIdentitiesById.set(memberId, memberIdentity)
    this.connectedMemberIds.add(memberId)

    this.emitter.emit('join', {peerId: memberId})
  }

  receiveLeaveNotification (rawMessage, leaveNotification) {
    const memberId = leaveNotification.getMemberId()
    if (this.isHub) {
      this.spokes.delete(memberId)
      this.forwardBroadcast(memberId, rawMessage)
    }
    this.memberDidLeave(memberId, leaveNotification.getConnectionLost())
  }

  memberDidLeave (peerId, connectionLost) {
    if (peerId === this.hubId) {
      this.hubId = null
      this.state = 'disconnected'
      this.resetConnectedMembers()
    } else {
      this.connectedMemberIds.delete(peerId)
    }

    this.emitter.emit('leave', {peerId, connectionLost})
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

  resetConnectedMembers () {
    this.connectedMemberIds.clear()
    this.connectedMemberIds.add(this.getPeerId())
  }
}

function serializePeerIdentity (identity) {
  const identityMessage = new PeerIdentity()
  identityMessage.setLogin(identity.login)
  return identityMessage
}

function deserializePeerIdentity (identityMessage) {
  return {
    login: identityMessage.getLogin()
  }
}
