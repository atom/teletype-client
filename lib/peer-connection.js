const SimplePeer = require('simple-peer')
const convertToProtobufCompatibleBuffer = require('./convert-to-protobuf-compatible-buffer')

module.exports =
class PeerConnection {
  constructor ({peerId, initiator, fragmentSize, pool, restGateway, iceServers}) {
    this.peerId = peerId
    this.initiator = initiator
    this.fragmentSize = fragmentSize
    this.pool = pool
    this.restGateway = restGateway
    this.iceServers = iceServers
    this.connected = false
    this.inboundSignalSequenceNumber = 1
    this.outboundSignalSequenceNumber = 1
    this.receivedSignals = []

    const simplePeerParams = {initiator, channelConfig: {ordered: true}}
    if (this.iceServers != null) {
      simplePeerParams.config = {iceServers: this.iceServers}
    }
    this.peer = new SimplePeer(simplePeerParams)

    this.peer.on('signal', this.sendSignal.bind(this))
    this.peer.on('connect', this.didConnect.bind(this))
    this.peer.on('data', this.receive.bind(this))
    this.peer.on('close', this.didDisconnect.bind(this))

    this.connectPromise = new Promise((resolve) => {
      this.resolveConnectPromise = resolve
    })
  }

  getConnectPromise () {
    return this.connectPromise
  }

  disconnect () {
    return new Promise((resolve) => {
      this.peer.destroy(resolve)
      this.connected = false
    })
  }

  sendSignal (data) {
    this.restGateway.post(`/peers/${this.peerId}/signals`, {
      senderId: this.pool.peerId,
      data: data,
      sequenceNumber: this.outboundSignalSequenceNumber++
    })
  }

  receiveSignal (sequenceNumber, data) {
    this.receivedSignals[sequenceNumber] = data

    while (true) {
      const signal = this.receivedSignals[this.inboundSignalSequenceNumber]
      if (!signal) break

      this.peer.signal(signal)
      this.inboundSignalSequenceNumber++
    }
  }

  didConnect () {
    this.receivedSignals.length = 0
    this.connected = true
    if (this.resolveConnectPromise) {
      this.resolveConnectPromise()
      this.resolveConnectPromise = null
    }
  }

  didDisconnect () {
    this.pool.didDisconnect({peerId: this.peerId})
  }

  send (message) {
    message = convertToProtobufCompatibleBuffer(message)

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
    const message = convertToProtobufCompatibleBuffer(envelope.slice(startOffset))
    this.pool.didReceiveMessage({senderId: this.peerId, message})
  }
}
