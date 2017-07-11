const SimplePeer = require('simple-peer')
const {Emitter} = require('event-kit')

const channelConfig = {ordered: true}

module.exports =
class PeerRegistry {
  constructor ({peerId, restGateway, pubSubGateway, delegate}) {
    this.peerId = peerId
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
    this.delegate = delegate

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
      peer.on('connect', () => resolve(new PeerConnection(peer)))
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
          this.delegate.didReceiveIncomingConnection(senderId, new PeerConnection(peer))
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
  multipart: 1 << 0,
  request: 1 << 1,
  response: 1 << 2
}

class PeerConnection {
  constructor (peer, chunkSize) {
    this.peer = peer
    this.chunkSize = chunkSize
    this.nextRequestId = 0
    this.requestResolveCallbacks = new Map()
    this.emitter = new Emitter()

    peer.on('data', this.didReceiveData.bind(this))
  }

  request (request) {
    const requestId = this.nextRequestId++
    const envelope = Buffer.alloc(1 + 4 + request.length)
    envelope.writeUInt8(metadataFlags.request, 0)
    envelope.writeUInt32BE(requestId, 1)
    request.copy(envelope, 5)

    this.peer.send(envelope)

    return new Promise((resolve) => {
      this.requestResolveCallbacks.set(requestId, resolve)
    })
  }

  respond (requestId, response) {
    const envelope = Buffer.alloc(1 + 4 + response.length)
    envelope.writeUInt8(metadataFlags.response, 0)
    envelope.writeUInt32BE(requestId, 1)
    response.copy(envelope, 5)

    this.peer.send(envelope)
  }

  onRequest (fn) {
    return this.emitter.on('request', fn)
  }

  didReceiveData (data) {
    const metadata = data.readUInt8(0)

    if (metadata & metadataFlags.request) {
      const requestId = data.readUInt32BE(1)
      const request = data.slice(5)
      this.emitter.emit('request', {requestId, request})
    } else if (metadata & metadataFlags.response) {
      const requestId = data.readUInt32BE(1)
      const response = data.slice(5)
      this.requestResolveCallbacks.get(requestId)(response)
      this.requestResolveCallbacks.delete(requestId)
    }
  }
}
