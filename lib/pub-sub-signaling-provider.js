const Errors = require('./errors')

module.exports =
class PubSubSignalingProvider {
  constructor ({localPeerId, authTokenProvider, remotePeerId, restGateway, testEpoch}) {
    this.localPeerId = localPeerId
    this.remotePeerId = remotePeerId
    this.authTokenProvider = authTokenProvider
    this.restGateway = restGateway
    this.testEpoch = testEpoch
    this.incomingSequenceNumber = 0
    this.outgoingSequenceNumber = 0
    this.incomingSignals = {}
  }

  async send (signal) {
    const oauthToken = await this.authTokenProvider.getToken(false)
    if (oauthToken) {
      const body = {
        senderId: this.localPeerId,
        sequenceNumber: this.outgoingSequenceNumber++,
        oauthToken,
        signal
      }
      if (this.testEpoch != null) body.testEpoch = this.testEpoch
      const {status} = await this.restGateway.post(`/peers/${this.remotePeerId}/signals`, body)
      if (status === 401) {
        this.authTokenProvider.didInvalidateToken()
        throw new Errors.AuthenticationError('The provided authentication token is invalid')
      }
    } else {
      throw new Errors.AuthenticationError('No token available to authenticate connection')
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
