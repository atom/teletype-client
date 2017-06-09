module.exports =
class FragmentInbox {
  constructor () {
    this.incomingMessageEnvelopesById = new Map()
  }

  receive (envelope) {
    if (envelope.fragmentCount === 1) {
      return JSON.parse(envelope.text)
    } else {
      let envelopes = this.incomingMessageEnvelopesById.get(envelope.messageId)
      if (!envelopes) {
        envelopes = []
        this.incomingMessageEnvelopesById.set(envelope.messageId, envelopes)
      }

      envelopes.push(envelope)
      if (envelopes.length === envelope.fragmentCount) {
        envelopes.sort((a, b) => a.fragmentIndex - b.fragmentIndex)
        let message = ''
        for (let i = 0; i < envelopes.length; i++) {
          message += envelopes[i].text
        }
        this.incomingMessageEnvelopesById.delete(envelope.messageId)
        return JSON.parse(message)
      }
    }
  }
}
