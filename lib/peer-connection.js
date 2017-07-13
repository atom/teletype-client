const SimplePeer = require('simple-peer')

module.exports =
class PeerConnection {
  constructor ({peerId, initiator, fragmentSize, pool, restGateway}) {
    this.peerId = peerId
    this.initiator = initiator
    this.fragmentSize = fragmentSize
    this.pool = pool
    this.restGateway = restGateway
    this.connected = false

    this.peer = new SimplePeer({initiator, channelConfig: {ordered: true}})
    this.peer.on('signal', this.sendSignal.bind(this))
    this.peer.on('connect', this.didConnect.bind(this))
    this.peer.on('data', this.receive.bind(this))

    this.connectPromise = new Promise((resolve) => {
      this.resolveConnectPromise = resolve
    })
  }

  getConnectPromise () {
    return this.connectPromise
  }

  sendSignal (data) {
    this.restGateway.post(`/peers/${this.peerId}/signals`, {
      senderId: this.pool.peerId,
      data: data
    })
  }

  receiveSignal (data) {
    this.peer.signal(data)
  }

  didConnect () {
    this.connected = true
    if (this.resolveConnectPromise) {
      this.resolveConnectPromise()
      this.resolveConnectPromise = null
    }
  }

  send (message) {
    if (!(message instanceof Buffer)) {
      message = Buffer.from(message)
    }

    let multiPartByte = 0
    let envelopeSize = message.length + 1
    if (envelopeSize > this.fragmentSize) {
      multiPartByte = 1
      envelopeSize += 4
    }

    const envelope = Buffer.alloc(envelopeSize)
    let offset = 0
    envelope.writeUInt8(multiPartByte, offset)
    offset++
    if (envelopeSize > this.fragmentSize) {
      envelope.writeUInt32BE(envelopeSize, offset)
      offset += 4
    }
    message.copy(envelope, offset)

    if (envelopeSize > this.fragmentSize) {
      let messageOffset = 0
      while (messageOffset < envelopeSize) {
        this.peer.send(envelope.slice(messageOffset, messageOffset + this.fragmentSize))
        messageOffset += this.fragmentSize
      }
    } else {
      this.peer.send(envelope)
    }
  }

  receive (data) {
    if (this.incomingMultipartEnvelope) {
      data.copy(this.incomingMultipartEnvelope, this.incomingMultipartEnvelopeOffset)
      this.incomingMultipartEnvelopeOffset += data.length
      if (this.incomingMultipartEnvelopeOffset === this.incomingMultipartEnvelope.length) {
        this.finishReceiving(this.incomingMultipartEnvelope)
        this.incomingMultipartEnvelope = null
        this.incomingMultipartEnvelopeOffset = 0
      }
    } else {
      const multiPartByte = data.readUInt8(0)
      if (multiPartByte & 1) {
        const envelopeSize = data.readUInt32BE(1)
        this.incomingMultipartEnvelope = Buffer.alloc(envelopeSize)
        data.copy(this.incomingMultipartEnvelope, 0)
        this.incomingMultipartEnvelopeOffset = data.length
      } else {
        this.finishReceiving(data)
      }
    }
  }

  finishReceiving (envelope) {
    const multiPartByte = envelope.readUInt8(0)
    const startOffset = (multiPartByte & 1) ? 5 : 1
    const message = envelope.slice(startOffset)
    this.pool.didReceiveMessage({senderId: this.peerId, message})
  }
}
