require('webrtc-adapter')

module.exports =
class PeerConnection {
  constructor ({peerId, fragmentSize, pool, restGateway, iceServers}) {
    this.peerId = peerId
    this.fragmentSize = fragmentSize
    this.pool = pool
    this.restGateway = restGateway
    this.iceServers = iceServers

    this.receivedSignals = {}
    this.inboundSignalSequenceNumber = 0
    this.outboundSignalSequenceNumber = 0

    this.connected = false
    this.disconnected = false

    this.rtcPeerConnection = new RTCPeerConnection({iceServers})
    this.rtcPeerConnection.oniceconnectionstatechange = this.handleICEConnectionStateChange.bind(this)
    this.rtcPeerConnection.onicecandidate = this.handleICECandidate.bind(this)
    this.rtcPeerConnection.ontrack = this.handleMediaTrack.bind(this)

    this.connectedPromise = new Promise((resolve) => this.resolveConnectedPromise = resolve)
    this.disconnectedPromise = new Promise((resolve) => this.resolveDisconnectedPromise = resolve)
  }

  connect () {
    if (this.connected) return Promise.resolve()

    this.negotiationNeeded = true
    const channel = this.rtcPeerConnection.createDataChannel(Math.random().toString(), {ordered: true})
    this.handleDataChannel({channel})
    this.rtcPeerConnection.onnegotiationneeded = this.handleNegotiationNeeded.bind(this)

    return this.getConnectedPromise()
  }

  getConnectedPromise () {
    return this.connectedPromise
  }

  getNextNegotiationCompletedPromise () {
    if (!this.nextNegotiationCompletedPromise) {
      this.nextNegotiationCompletedPromise = new Promise((resolve) => {
        this.resolveNextNegotiationCompletedPromise = resolve
      })
    }
    return this.nextNegotiationCompletedPromise
  }

  getDisconnectedPromise () {
    return this.disconnectedPromise
  }

  disconnect () {
    if (this.disconnected) return
    this.disconnected = true
    this.connected = false
    this.channel.close()
    this.rtcPeerConnection.close()
    this.pool.didDisconnect(this.peerId)
    this.resolveDisconnectedPromise()
  }

  handleICEConnectionStateChange () {
    const {iceConnectionState, signalingState} = this.rtcPeerConnection

    if (iceConnectionState === 'connected') {
      if (!this.connected) {
        this.connected = true
        this.resolveConnectedPromise()
      }

      if (this.nextNegotiationCompletedPromise) {
        this.resolveNextNegotiationCompletedPromise()
        this.nextNegotiationCompletedPromise = null
        this.resolveNextNegotiationCompletedPromise = null
      }
    }

    if (iceConnectionState === 'disconnected' && signalingState === 'stable') {
      this.disconnect()
    }
  }

  async handleNegotiationNeeded () {
    if (!this.negotiationNeeded) return
    this.negotiationNeeded = false
    const offer = await this.rtcPeerConnection.createOffer()
    await this.rtcPeerConnection.setLocalDescription(offer)
    this.sendSignal({offer: this.rtcPeerConnection.localDescription})
  }

  handleICECandidate ({candidate}) {
    this.sendSignal({candidate})
  }

  handleDataChannel ({channel}) {
    this.channel = channel
    this.channel.binaryType = 'arraybuffer'
    this.channel.onmessage = ({data}) => this.receive(Buffer.from(data))
  }

  sendSignal (signal) {
    if (this.disconnected) return

    signal.sequenceNumber = this.outboundSignalSequenceNumber++
    this.restGateway.post(`/peers/${this.peerId}/signals`, {
      senderId: this.pool.peerId,
      signal
    })
  }

  receiveSignal (signal) {
    if (this.disconnected) return

    this.receivedSignals[signal.sequenceNumber] = signal

    while (true) {
      const signal = this.receivedSignals[this.inboundSignalSequenceNumber]
      if (signal) {
        delete this.receivedSignals[this.inboundSignalSequenceNumber]
        this.inboundSignalSequenceNumber++
        this.handleSignal(signal)
      } else {
        break
      }
    }
  }

  async handleSignal (signal) {
    if (signal.offer) {
      this.rtcPeerConnection.ondatachannel = this.handleDataChannel.bind(this)
      await this.rtcPeerConnection.setRemoteDescription(signal.offer)
      const answer = await this.rtcPeerConnection.createAnswer()
      await this.rtcPeerConnection.setLocalDescription(answer)
      this.sendSignal({answer: this.rtcPeerConnection.localDescription})
    } else if (signal.answer) {
      await this.rtcPeerConnection.setRemoteDescription(signal.answer)
    } else if (signal.candidate) {
      this.rtcPeerConnection.addIceCandidate(signal.candidate)
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

  addMediaTrack (track, stream) {
    this.negotiationNeeded = true
    this.rtcPeerConnection.addTrack(track, stream)
  }

  handleMediaTrack ({track}) {
    this.pool.didReceiveMediaTrack({senderId: this.peerId, track})
  }
}
