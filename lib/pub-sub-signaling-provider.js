const Errors = require('./errors')

module.exports =
class PubSubSignalingProvider {
  constructor ({localPeerId, remotePeerId, restGateway, testEpoch}) {
    this.localPeerId = localPeerId
    this.remotePeerId = remotePeerId
    this.restGateway = restGateway
    this.testEpoch = testEpoch
    this.incomingSequenceNumber = 0
    this.outgoingSequenceNumber = 0
    this.incomingSignals = {}
  }

  async send (signal) {
    const request = {
      senderId: this.localPeerId,
      sequenceNumber: this.outgoingSequenceNumber++,
      signal
    }
    if (this.testEpoch != null) request.testEpoch = this.testEpoch

    const {ok, status, body} = await this.restGateway.post(`/peers/${this.remotePeerId}/signals`, request)
    if (status === 401) {
      throw new Errors.InvalidAuthenticationTokenError('The provided authentication token is invalid')
    } else if (!ok) {
      throw new Errors.PubSubConnectionError('Error signalling peer: ' + body.message)
    }
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
