const SimplePeer = require('simple-peer')

module.exports =
class PeerConnection {
  constructor ({peerId, initiator, fragmentSize, pool, restGateway, iceServers}) {
    this.peerId = peerId
    this.initiator = initiator
    this.fragmentSize = fragmentSize
    this.pool = pool
    this.restGateway = restGateway
    this.iceServers = iceServers
    this.assignedRemoteDescription = false
    this.pendingIceCandidates = []
    this.connected = false

    this.rtcPeerConnection = new RTCPeerConnection({iceServers})
    this.rtcPeerConnection.oniceconnectionstatechange = this.handleIceConnectionStateChange.bind(this)
    this.rtcPeerConnection.onicecandidate = this.handleICECandidate.bind(this)
    if (this.initiator) {
      const channel = this.rtcPeerConnection.createDataChannel(Math.random().toString(), {ordered: true})
      this.handleDataChannel({channel})
      this.rtcPeerConnection.onnegotiationneeded = this.handleNegotiationNeeded.bind(this)
    } else {
      this.rtcPeerConnection.ondatachannel = this.handleDataChannel.bind(this)
    }

    this.connectPromise = new Promise((resolve) => {
      this.resolveConnectPromise = resolve
    })
  }

  async handleNegotiationNeeded () {
    const offer = await this.rtcPeerConnection.createOffer()
    await this.rtcPeerConnection.setLocalDescription(offer)
    this.sendSignal({offer: this.rtcPeerConnection.localDescription})
  }

  handleICECandidate ({candidate}) {
    this.sendSignal({candidate})
  }

  handleIceConnectionStateChange () {
    const {iceConnectionState} = this.rtcPeerConnection
    const connected = (iceConnectionState === 'connected' || iceConnectionState === 'completed')

    if (!this.connected && connected) {
      this.connected = true
      if (this.resolveConnectPromise) {
        this.resolveConnectPromise()
        this.resolveConnectPromise = null
      }
    }

    if (this.connected && !connected) {
      this.connected = false
      this.pool.didDisconnect(this.peerId)
    }
  }

  handleDataChannel ({channel}) {
    this.channel = channel
    this.channel.binaryType = 'arraybuffer'
    this.channel.onmessage = ({data}) => this.receive(Buffer.from(data))
    this.channelOpenPromise = new Promise((resolve) => {
      this.channel.onopen = resolve
    })
  }

  getConnectPromise () {
    return Promise.all([this.connectPromise, this.channelOpenPromise])
  }

  disconnect () {
    this.connected = false
    this.rtcPeerConnection.close()
    this.pool.didDisconnect(this.peerId)
  }

  sendSignal (signal) {
    this.restGateway.post(`/peers/${this.peerId}/signals`, {
      senderId: this.pool.peerId,
      signal
    })
  }

  async receiveSignal (signal) {
    if (signal.offer) {
      this.rtcPeerConnection.setRemoteDescription(signal.offer)
      this.assignedRemoteDescription = true
      this.addPendingIceCandidates()
      const answer = await this.rtcPeerConnection.createAnswer()
      await this.rtcPeerConnection.setLocalDescription(answer)
      this.sendSignal({answer: this.rtcPeerConnection.localDescription})
    } else if (signal.answer) {
      this.rtcPeerConnection.setRemoteDescription(signal.answer)
      this.assignedRemoteDescription = true
      this.addPendingIceCandidates()
    } else if (signal.candidate) {
      if (this.assignedRemoteDescription) {
        this.rtcPeerConnection.addIceCandidate(signal.candidate)
      } else {
        this.pendingIceCandidates.push(signal.candidate)
      }
    }
  }

  addPendingIceCandidates () {
    let candidate
    while ((candidate = this.pendingIceCandidates.shift())) {
      this.rtcPeerConnection.addIceCandidate(candidate)
    }
  }

  send (message) {
    if (!this.connected) throw new Error('Must be connected to send')

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
        this.channel.send(envelope.slice(messageOffset, messageOffset + this.fragmentSize))
        messageOffset += this.fragmentSize
      }
    } else {
      this.channel.send(envelope)
    }
  }

  receive (data) {
    if (!this.connected) return

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
