const assert = require('assert')
const {Emitter} = require('event-kit')

const metadataFlags = {
  connect: 1 << 0,
  broadcast: 2 << 1
}

module.exports =
class StarOverlayNetwork {
  constructor ({id, peerPool, isHub}) {
    this.id = id
    this.peerPool = peerPool
    this.isHub = isHub
    if (this.isHub) this.spokes = new Set()
    this.emitter = new Emitter()

    peerPool.onReceive(this.receive.bind(this))
  }

  async connectTo (hubId) {
    assert(!this.isHub, 'The hub should only receive connections')
    this.hubId = hubId
    await this.peerPool.connectTo(this.hubId)

    const idByteLength = Buffer.byteLength(this.id)
    const connectMessage = Buffer.alloc(1 + 2 + idByteLength)
    connectMessage.writeUInt8(metadataFlags.connect, 0)

    this.peerPool.send(this.hubId, connectMessage)
  }

  broadcast (message) {
    const senderId = this.peerPool.peerId
    const senderIdLength = Buffer.byteLength(senderId)
    const envelope = Buffer.alloc(1 + 2 + senderIdLength + message.length)
    envelope.writeUInt8(metadataFlags.broadcast)
    envelope.writeUInt16BE(senderIdLength, 1)
    envelope.write(senderId, 3)
    message.copy(envelope, 1 + 2 + senderIdLength)

    this.peerPool.send(this.hubId, envelope)
  }

  onReceive (callback) {
    return this.emitter.on('receive', callback)
  }

  receive ({senderId, message}) {
    if (isConnection(message)) {
      this.receiveConnection(senderId)
    } else if (isBroadcast(message)) {
      this.receiveBroadcast(message)
    }
  }

  receiveConnection (senderId) {
    assert(this.isHub, 'Can only receive the connections at the hub')
    this.spokes.add(senderId)
  }

  receiveBroadcast (message) {
    const senderId = getSenderId(message)

    if (this.isHub) {
      this.spokes.forEach((peerId) => {
        if (peerId !== senderId) {
          this.peerPool.send(peerId, message)
        }
      })
    }

    this.emitter.emit('receive', {
      senderId, message: getBody(message)
    })
  }
}

function isConnection (message) {
  const metadata = message.readUInt8(0)
  return metadata & metadataFlags.connect
}

function isBroadcast (message) {
  const metadata = message.readUInt8(0)
  return metadata & metadataFlags.broadcast
}

function getSenderIdLength (message) {
  return message.readUInt16BE(1)
}

function getSenderId (message) {
  assert(isBroadcast(message))
  return message.toString('utf8', 3, 3 + getSenderIdLength(message))
}

function getBody (message) {
  return message.slice(1 + 2 + getSenderIdLength(message))
}
