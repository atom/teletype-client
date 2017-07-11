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

const metadataFlags = {
  empty: 0,
  multipart: 1 << 0,
  request: 1 << 1,
  response: 1 << 2
}

class PeerConnection {
  constructor (peer, fragmentSize) {
    this.peer = peer
    this.fragmentSize = fragmentSize
    this.nextRequestId = 0
    this.requestResolveCallbacks = new Map()
    this.emitter = new Emitter()

    peer.on('data', this.didReceiveData.bind(this))
  }

  notify (notification) {
    this.send(metadataFlags.empty, notification)
  }

  request (request) {
    const requestId = this.nextRequestId++
    this.send(metadataFlags.request, request, requestId)
    return new Promise((resolve) => {
      this.requestResolveCallbacks.set(requestId, resolve)
    })
  }

  respond (requestId, response) {
    this.send(metadataFlags.response, response, requestId)
  }

  onNotification (fn) {
    return this.emitter.on('notification', fn)
  }

  onRequest (fn) {
    return this.emitter.on('request', fn)
  }

  send (metadata, message, requestId) {
    let envelopeSize = message.length + 1
    if (requestId != null) envelopeSize += 4

    if (envelopeSize > this.fragmentSize) {
      metadata = metadata | metadataFlags.multipart
      envelopeSize += 4
    }

    const envelope = Buffer.alloc(envelopeSize)
    let offset = 0
    envelope.writeUInt8(metadata, offset)
    offset++
    if (envelopeSize > this.fragmentSize) {
      envelope.writeUInt32BE(envelopeSize, offset)
      offset += 4
    }
    if (requestId != null) {
      envelope.writeUInt32BE(requestId, offset)
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
      const metadata = data.readUInt8(0)
      if (metadata & metadataFlags.multipart) {
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
    const metadata = envelope.readUInt8(0)
    const isRequest = metadata & metadataFlags.request
    const isResponse = metadata & metadataFlags.response
    const startOffset = (metadata & metadataFlags.multipart) ? 5 : 1

    if (isRequest || isResponse) {
      const requestId = envelope.readUInt32BE(startOffset)
      const message = envelope.slice(startOffset + 4)

      if (isRequest) {
        this.emitter.emit('request', {requestId, request: message})
      } else {
        this.requestResolveCallbacks.get(requestId)(message)
        this.requestResolveCallbacks.delete(requestId)
      }
    } else {
      const notification = envelope.slice(startOffset)
      this.emitter.emit('notification', notification)
    }
  }
}
