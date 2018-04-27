require('webrtc-adapter')

const MAX_SEND_RETRY_COUNT = 5
const MULTIPART_MASK = 0b00000001
const DISCONNECT_MASK = 0b00000010

const convertToProtobufCompatibleBuffer = require('./convert-to-protobuf-compatible-buffer')
const Errors = require('./errors')

module.exports =
class PeerConnection {
  constructor (props) {
    const {
      localPeerId, remotePeerId, fragmentSize, iceServers, connectionTimeout,
      signalingProvider, didReceiveMessage, didDisconnect, didError
    } = props

    this.localPeerId = localPeerId
    this.remotePeerId = remotePeerId
    this.fragmentSize = fragmentSize
    this.iceServers = iceServers
    this.connectionTimeout = connectionTimeout
    this.signalingProvider = signalingProvider
    this.didReceiveMessage = didReceiveMessage
    this.didDisconnect = didDisconnect
    this.didError = didError

    this.receivedSignals = {}
    this.incomingSignalSequenceNumber = 0
    this.outgoingSignalSequenceNumber = 0

    this.state = 'initial'
    this.initiator = false

    this.signalingProvider.receive = this.receiveSignal.bind(this)

    this.rtcPeerConnection = new RTCPeerConnection({iceServers})
    this.rtcPeerConnection.oniceconnectionstatechange = this.handleConnectionStateChange.bind(this)
    this.rtcPeerConnection.onicecandidate = this.handleICECandidate.bind(this)
    this.rtcPeerConnection.ondatachannel = this.handleDataChannel.bind(this)
    this.rtcPeerConnection.onerror = this.handleError.bind(this)

    this.connectedPromise = new Promise((resolve, reject) => {
      this.resolveConnectedPromise = resolve
      this.rejectConnectedPromise = reject
    })
    this.disconnectedPromise = new Promise((resolve) => this.resolveDisconnectedPromise = resolve)
  }

  connect () {
    if (this.state === 'initial') {
      this.state = 'connecting'
      this.initiator = true
      this.rtcPeerConnection.onnegotiationneeded = this.handleNegotiationNeeded.bind(this)
      this.negotiationNeeded = true
      const channel = this.rtcPeerConnection.createDataChannel(null, {ordered: true})
      this.handleDataChannel({channel})
      const timeoutError = new Errors.PeerConnectionError('Connecting to peer timed out')
      setTimeout(() => {
        if (this.state === 'connecting') {
          this.disconnect()
          this.rejectConnectedPromise(timeoutError)
        }
      }, this.connectionTimeout)
    }

    return this.getConnectedPromise()
  }

  getConnectedPromise () {
    return this.connectedPromise
  }

  getDisconnectedPromise () {
    return this.disconnectedPromise
  }

  disconnect () {
    if (this.state === 'disconnected') return
    this.state = 'disconnected'

    this.didDisconnect(this.remotePeerId)
    this.resolveDisconnectedPromise()

    // Give channel a chance to flush. This helps avoid flaky tests where
    // the a star network hub disconnects all its peers and needs to
    // inform the remaining peers of the disconnection as each peer leaves.
    process.nextTick(() => {
      if (this.channel) {
        try {
          this.channel.send(Buffer.alloc(1, DISCONNECT_MASK))
        } catch (e) {
          // Ignore the exception since the connection is about to be closed.
        } finally {
          this.channel.close()
        }
      }

      if (this.rtcPeerConnection.signalingState !== 'closed') {
        this.rtcPeerConnection.close()
      }
    })
  }

  async handleNegotiationNeeded () {
    if (!this.negotiationNeeded || this.state === 'disconnected') return
    this.negotiationNeeded = false
    const offer = await this.rtcPeerConnection.createOffer()
    await this.rtcPeerConnection.setLocalDescription(offer)
    try {
      await this.sendSignal({offer, senderId: this.localPeerId})
    } catch (error) {
      this.disconnect()
      this.rejectConnectedPromise(error)
    }
  }

  async handleICECandidate ({candidate}) {
    try {
      await this.sendSignal({candidate})
    } catch (error) {
      this.disconnect()
      if (this.initiator) {
        this.rejectConnectedPromise(error)
      } else {
        this.handleError(error)
      }
    }
  }

  handleDataChannel ({channel}) {
    this.channel = channel
    this.channel.binaryType = 'arraybuffer'
    this.channel.onerror = this.handleError.bind(this)
    this.channel.onmessage = ({data}) => this.receive(Buffer.from(data))
    this.channel.onclose = () => this.disconnect()

    if (this.channel.readyState === 'open') {
      this.handleConnectionStateChange()
    } else {
      this.channel.onopen = this.handleConnectionStateChange.bind(this)
    }
  }

  handleConnectionStateChange () {
    if (this.isConnectionOpen() && this.state !== 'connected') {
      this.state = 'connected'
      this.resolveConnectedPromise()
    } else if (this.isConnectionClosed() && this.state !== 'disconnected') {
      this.disconnect()
    }
  }

  isConnectionOpen () {
    const {iceConnectionState} = this.rtcPeerConnection
    return (
      (iceConnectionState === 'connected' || iceConnectionState === 'completed') &&
      this.channel && this.channel.readyState === 'open'
    )
  }

  isConnectionClosed () {
    const {iceConnectionState, signalingState} = this.rtcPeerConnection
    return (
      iceConnectionState === 'closed' ||
      iceConnectionState === 'failed' ||
      (iceConnectionState === 'disconnected' && signalingState === 'stable')
    )
  }

  handleError (event) {
    this.didError({peerId: this.remotePeerId, event})
  }

  sendSignal (signal) {
    if (this.state !== 'disconnected') {
      return this.signalingProvider.send(signal)
    }
  }

  async receiveSignal (signal) {
    if (this.state === 'disconnected') return

    if (signal.offer) {
      await this.rtcPeerConnection.setRemoteDescription(signal.offer)
      const answer = await this.rtcPeerConnection.createAnswer()
      await this.rtcPeerConnection.setLocalDescription(answer)
      try {
        await this.sendSignal({answer})
      } catch (error) {
        this.disconnect()
        this.handleError(error)
      }
    } else if (signal.answer) {
      await this.rtcPeerConnection.setRemoteDescription(signal.answer)
    } else if (signal.candidate) {
      this.rtcPeerConnection.addIceCandidate(signal.candidate)
    }
  }

  send (message) {
    if (this.state !== 'connected') throw new Error('Must be connected to send')

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
    if (this.state !== 'connected') return

    if (this.incomingMultipartEnvelope) {
      data.copy(this.incomingMultipartEnvelope, this.incomingMultipartEnvelopeOffset)
      this.incomingMultipartEnvelopeOffset += data.length
      if (this.incomingMultipartEnvelopeOffset === this.incomingMultipartEnvelope.length) {
        this.finishReceiving(this.incomingMultipartEnvelope)
        this.incomingMultipartEnvelope = null
        this.incomingMultipartEnvelopeOffset = 0
      }
    } else {
      const metadataByte = data.readUInt8(0)

      if (metadataByte & MULTIPART_MASK) {
        const envelopeSize = data.readUInt32BE(1)
        this.incomingMultipartEnvelope = Buffer.alloc(envelopeSize)
        data.copy(this.incomingMultipartEnvelope, 0)
        this.incomingMultipartEnvelopeOffset = data.length
      } else if (metadataByte & DISCONNECT_MASK) {
        this.disconnect()
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
}
