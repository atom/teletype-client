const SimplePeer = require('simple-peer')
const {Emitter} = require('event-kit')

module.exports =
class PeerPool {
  constructor ({peerId, restGateway, pubSubGateway, fragmentSize}) {
    this.peerId = peerId
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.fragmentSize = fragmentSize
    this.emitter = new Emitter()
    this.peerConnectionsById = new Map()
  }

  async subscribe () {
    await this.pubSubGateway.subscribe(`/peers/${this.peerId}`, 'signal', this.didReceiveSignal.bind(this))
  }

  connectTo (peerId) {
    const peerConnection = this.getPeerConnection(peerId, true)
    return peerConnection.getConnectPromise()
  }

  send (peerId, message) {
    this.peerConnectionsById.get(peerId).send(message)
  }

  onReceive (callback) {
    return this.emitter.on('receive', callback)
  }

  isConnectedToPeer (peerId) {
    const peerConnection = this.peerConnectionsById.get(peerId)
    return peerConnection ? peerConnection.connected : false
  }

  didReceiveSignal ({senderId, data}) {
    const peerConnection = this.getPeerConnection(senderId, false)
    peerConnection.receiveSignal(data)
  }

  didReceiveMessage (event) {
    this.emitter.emit('receive', event)
  }

  getPeerConnection (peerId, initiator) {
    let peerConnection = this.peerConnectionsById.get(peerId)
    if (!peerConnection) {
      peerConnection = new PeerConnection({
        peerId,
        initiator,
        fragmentSize: this.fragmentSize,
        pool: this,
        restGateway: this.restGateway,
      })
      this.peerConnectionsById.set(peerId, peerConnection)
    }
    return peerConnection
  }
}

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
