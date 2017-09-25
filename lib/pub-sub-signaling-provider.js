module.exports =
class PubSubSignalingProvider {
  constructor ({localPeerId, oauthToken, remotePeerId, restGateway, testEpoch}) {
    this.localPeerId = localPeerId
    this.remotePeerId = remotePeerId
    this.oauthToken = oauthToken
    this.restGateway = restGateway
    this.testEpoch = testEpoch
    this.incomingSequenceNumber = 0
    this.outgoingSequenceNumber = 0
    this.incomingSignals = {}
  }

  send (signal) {
    const body = {
      senderId: this.localPeerId,
      sequenceNumber: this.outgoingSequenceNumber++,
      oauthToken: this.oauthToken,
      signal
    }
    if (this.testEpoch != null) body.testEpoch = this.testEpoch
    this.restGateway.post(`/peers/${this.remotePeerId}/signals`, body)
  }

  async receiveMessage ({testEpoch, sequenceNumber, signal}) {
    if (this.testEpoch && this.testEpoch !== testEpoch) return

    this.incomingSignals[sequenceNumber] = signal

    if (!this.receivingSignals) {
      this.receivingSignals = true
      while (true) {
        const signal = this.incomingSignals[this.incomingSequenceNumber]
        if (signal) {
          delete this.incomingSignals[this.incomingSequenceNumber]
          await this.receive(signal)
          this.incomingSequenceNumber++
        } else {
          break
        }
      }
      this.receivingSignals = false
    }
  }
}
