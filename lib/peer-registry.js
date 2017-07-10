const SimplePeer = require('simple-peer')

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
    const peer = new SimplePeer({initiator: true})

    peer.on('signal', (data) => {
      this.restGateway.post(`/peers/${peerId}/signals`, {
        senderId: this.peerId,
        type: 'offer',
        data: data
      })
    })

    this.peersById.set(peerId, peer)

    return new Promise((resolve) => {
      peer.on('connect', () => resolve(peer))
    })
  }

  didReceiveSignal ({senderId, type, data}) {
    if (type === 'offer') {
      let peer = this.peersById.get(senderId)
      if (!peer) {
        peer = new SimplePeer()
        peer.on('signal', (data) => {
          this.restGateway.post(`/peers/${senderId}/signals`, {
            senderId: this.peerId,
            type: 'answer',
            data: data
          })
        })
        peer.on('connect', () => {
          console.log('incoming connection established');
          this.delegate.didReceiveIncomingConnection(senderId, peer)
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
