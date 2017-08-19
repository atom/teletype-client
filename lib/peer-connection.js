require('webrtc-adapter')

MAX_SEND_RETRY_COUNT = 5

const convertToProtobufCompatibleBuffer = require('./convert-to-protobuf-compatible-buffer')

module.exports =
class PeerConnection {
  constructor (props) {
    const {
      localPeerId, remotePeerId, fragmentSize, iceServers,
      signalingProvider, didReceiveMessage, didReceiveTrack, didDisconnect
    } = props

    this.localPeerId = localPeerId
    this.remotePeerId = remotePeerId
    this.fragmentSize = fragmentSize
    this.iceServers = iceServers
    this.signalingProvider = signalingProvider
    this.didReceiveMessage = didReceiveMessage
    this.didReceiveTrack = didReceiveTrack
    this.didDisconnect = didDisconnect

    this.receivedSignals = {}
    this.incomingSignalSequenceNumber = 0
    this.outgoingSignalSequenceNumber = 0
    this.outgoingTracks = new Set()
    this.incomingTracksById = new Map()

    this.connected = false
    this.disconnected = false

    this.signalingProvider.receive = this.receiveSignal.bind(this)

    this.rtcPeerConnection = new RTCPeerConnection({iceServers})
    this.rtcPeerConnection.oniceconnectionstatechange = this.handleICEConnectionStateChange.bind(this)
    this.rtcPeerConnection.onicecandidate = this.handleICECandidate.bind(this)
    this.rtcPeerConnection.ondatachannel = this.handleDataChannel.bind(this)
    this.rtcPeerConnection.ontrack = this.handleTrack.bind(this)

    this.connectedPromise = new Promise((resolve) => this.resolveConnectedPromise = resolve)
    this.disconnectedPromise = new Promise((resolve) => this.resolveDisconnectedPromise = resolve)
  }

  connect () {
    if (this.connected) return Promise.resolve()

    this.rtcPeerConnection.onnegotiationneeded = this.handleNegotiationNeeded.bind(this)
    this.negotiationNeeded = true
    const channel = this.rtcPeerConnection.createDataChannel(null, {ordered: true})
    this.handleDataChannel({channel})

    return this.getConnectedPromise()
  }

  getConnectedPromise () {
    return this.connectedPromise
  }

  getDisconnectedPromise () {
    return this.disconnectedPromise
  }

  disconnect () {
    this.disconnected = true
    if (!this.connected) return
    this.connected = false

    this.didDisconnect(this.remotePeerId)
    this.resolveDisconnectedPromise()

    // Get channel a chance to flush. This helps avoid flaky tests where
    // the a star network hub disconnects all its peers and needs to
    // inform the remaining peers of the disconnection as each peer leaves.
    process.nextTick(() => {
      if (this.channel) this.channel.close()
      this.rtcPeerConnection.close()
    })
  }

  handleICEConnectionStateChange () {
    const {iceConnectionState, signalingState} = this.rtcPeerConnection

    if (iceConnectionState === 'connected' && !this.connected) {
      this.connected = true

      if (!this.rtcPeerConnection.onnegotiationneeded) {
        this.rtcPeerConnection.onnegotiationneeded = this.handleNegotiationNeeded.bind(this)
      }

      this.resolveConnectedPromise()
    }

    if (iceConnectionState === 'disconnected' && signalingState === 'stable') {
      this.disconnect()
    }
  }

  async handleNegotiationNeeded () {
    if (!this.negotiationNeeded || this.disconnected) return
    this.negotiationNeeded = false
    this.pendingOffer = await this.rtcPeerConnection.createOffer()
    this.sendSignal({
      offer: this.pendingOffer,
      senderId: this.localPeerId
    })
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

    this.signalingProvider.send(signal)
  }

  async receiveSignal (signal) {
    if (this.disconnected) return

    if (signal.offer) {
      // If there is already a pending offer, only accept this
      // concurrently-created offer it comes from a peer with a lower id.
      if (this.pendingOffer) {
        if (signal.senderId.localeCompare(this.localPeerId) < 0) {
          this.negotiationNeeded = true
        } else {
          return
        }
      }

      await this.rtcPeerConnection.setRemoteDescription(signal.offer)
      const answer = await this.rtcPeerConnection.createAnswer()
      await this.rtcPeerConnection.setLocalDescription(answer)
      this.sendSignal({answer: this.rtcPeerConnection.localDescription})

      // If we accepted a concurrent offer, the details of our pending
      // offer were discarded, so trigger a new round of negotiation.
      if (this.negotiationNeeded) this.handleNegotiationNeeded()
    } else if (signal.answer) {
      await this.rtcPeerConnection.setLocalDescription(this.pendingOffer)
      await this.rtcPeerConnection.setRemoteDescription(signal.answer)
      delete this.pendingOffer
    } else if (signal.candidate) {
      this.rtcPeerConnection.addIceCandidate(signal.candidate)
    }
  }

  send (message) {
    if (!this.connected) throw new Error('Must be connected to send')

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
        this.channel.send(envelope.slice(messageOffset, messageOffset + this.fragmentSize))
        messageOffset += this.fragmentSize
      }
    } else {
      let retryCount = 0
      while (true) {
        // Calling send on the data channel sometimes throws in tests
        // even when the channel's readyState is 'open'. It always seems
        // to work on the first retry, but we can retry a few times.
        try {
          this.channel.send(envelope)
          break
        } catch (error) {
          if (retryCount++ === MAX_SEND_RETRY_COUNT) throw error
        }
      }
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
    const message = convertToProtobufCompatibleBuffer(envelope.slice(startOffset))
    this.didReceiveMessage({senderId: this.remotePeerId, message})
  }

  addTrack (track, stream) {
    if (this.outgoingTracks.has(track)) return
    this.outgoingTracks.add(track)

    this.negotiationNeeded = true
    this.rtcPeerConnection.addTrack(track, stream)
    track.addEventListener('ended', () => {
      if (this.connected) {
        const sender = this.rtcPeerConnection.getSenders().find((s) => s.track === track)
        if (sender) {
          this.negotiationNeeded = true
          this.outgoingTracks.delete(track)
          this.rtcPeerConnection.removeTrack(sender)
        }
      }
    }, {once: true})
  }

  getIncomingTrack (id) {
    return this.incomingTracksById.get(id)
  }

  handleTrack ({track}) {
    this.incomingTracksById.set(track.id, track)
    track.addEventListener('ended', () => {
      this.incomingTracksById.delete(track.id)
    }, {once: true})
    this.didReceiveTrack({senderId: this.remotePeerId, track})
  }
}
