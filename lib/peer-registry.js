const SimplePeer = require('simple-peer')
const {Emitter} = require('event-kit')

const channelConfig = {ordered: true}

module.exports =
class PeerRegistry {
  constructor ({peerId, restGateway, pubSubGateway, delegate, fragmentSize}) {
    this.peerId = peerId
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.delegate = delegate
    this.fragmentSize = fragmentSize

    this.peersById = new Map()
  }

  async subscribe () {
    await this.pubSubGateway.subscribe(`/peers/${this.peerId}`, 'signal', this.didReceiveSignal.bind(this))
  }

  connect (peerId) {
    const peer = new SimplePeer({initiator: true, channelConfig})

    peer.on('signal', (data) => {
      this.restGateway.post(`/peers/${peerId}/signals`, {
        senderId: this.peerId,
        type: 'offer',
        data: data
      })
    })

    this.peersById.set(peerId, peer)

    return new Promise((resolve) => {
      peer.on('connect', () => resolve(new PeerConnection(peer, this.fragmentSize)))
    })
  }

  didReceiveSignal ({senderId, type, data}) {
    if (type === 'offer') {
      let peer = this.peersById.get(senderId)
      if (!peer) {
        peer = new SimplePeer({channelConfig})
        peer.on('signal', (data) => {
          this.restGateway.post(`/peers/${senderId}/signals`, {
            senderId: this.peerId,
            type: 'answer',
            data: data
          })
        })
        peer.on('connect', () => {
          this.delegate.didReceiveIncomingConnection(senderId, new PeerConnection(peer, this.fragmentSize))
        })
        this.peersById.set(senderId, peer)
      }

      peer.signal(data)
    } else if (type === 'answer') {
      const peer = this.peersById.get(senderId)
      peer.signal(data)
    } else {
      throw new Error(`Unknown signal type '${type}'`)
    }
  }
}

class PeerConnection {
  constructor (peer, fragmentSize) {
    this.peer = peer
    this.fragmentSize = fragmentSize
    this.emitter = new Emitter()
    peer.on('data', this.didReceiveData.bind(this))
  }

  onReceive (callback) {
    return this.emitter.on('receive', callback)
  }

  send (message) {
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

  didReceiveData (data) {
    if (this.incomingMultipartEnvelope) {
      data.copy(this.incomingMultipartEnvelope, this.incomingMultipartEnvelopeOffset)
      this.incomingMultipartEnvelopeOffset += data.length
      if (this.incomingMultipartEnvelopeOffset === this.incomingMultipartEnvelope.length) {
        this.didReceiveEnvelope(this.incomingMultipartEnvelope)
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
        this.didReceiveEnvelope(data)
      }
    }
  }

  didReceiveEnvelope (envelope) {
    const multiPartByte = envelope.readUInt8(0)
    const startOffset = (multiPartByte & 1) ? 5 : 1
    const message = envelope.slice(startOffset)
    this.emitter.emit('receive', message)
  }
}
