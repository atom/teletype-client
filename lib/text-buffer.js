const {CompositeDisposable} = require('event-kit')
const {DocumentReplica, serializeOperation, deserializeOperation} = require('@atom/tachyon')
const Messages = require('./real-time_pb')

module.exports =
class TextBuffer {
  static deserialize (message, props) {
    const id = message.getId()
    const uri = message.getUri()
    const operations = message.getOperationsList().map(deserializeOperation)
    return new TextBuffer(Object.assign({id, uri, operations}, props))
  }

  constructor ({portalId, id, uri, text, operations, router, siteId}) {
    this.portalId = portalId
    this.id = id
    this.siteId = siteId
    this.uri = uri
    this.router = router

    this.replica = new DocumentReplica(siteId)
    this.receivedOperations = []
    this.appliedOperationIds = new Set()
    this.subscriptions = new CompositeDisposable()
    this.subscriptions.add(
      this.router.onNotification(`/portals/${this.portalId}/buffers/${this.id}`, this.receiveUpdate.bind(this))
    )

    if (text) {
      const operation = this.replica.insertLocal({position: {row: 0, column: 0}, text})
      this.receivedOperations.push(operation)
      this.appliedOperationIds.add(operation.opId)
    } else if (operations) {
      this.applyRemoteOperations(operations)
    }
  }

  dispose () {
    if (this.subscriptions) this.subscriptions.dispose()
  }

  serialize () {
    const textBufferMessage = new Messages.TextBuffer()
    textBufferMessage.setId(this.id)
    textBufferMessage.setUri(this.uri)
    textBufferMessage.setOperationsList(this.receivedOperations.map(serializeOperation))
    return textBufferMessage
  }

  setDelegate (delegate) {
    this.delegate = delegate
    if (this.siteId !== 1) this.delegate.setText(this.replica.getText())
  }

  apply (op) {
    return this.applyMany([op])
  }

  applyMany (operations) {
    const opsToSend = []
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i]
      const opToSend = this.replica.applyLocal(op)
      const opId = opIdToString(opToSend.opId)
      this.appliedOperationIds.add(opId)
      opsToSend.push(serializeOperation(opToSend))
    }

    const updateMessage = new Messages.TextBufferUpdate()
    updateMessage.setOperationsList(opsToSend)
    this.router.notify(`/portals/${this.portalId}/buffers/${this.id}`, updateMessage.serializeBinary())
  }

  receiveUpdate ({message}) {
    const updateMessage = Messages.TextBufferUpdate.deserializeBinary(message)
    const operations = updateMessage.getOperationsList().map(deserializeOperation)
    this.applyRemoteOperations(operations)
  }

  applyRemoteOperations (operations) {
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i]
      const opId = opIdToString(op.opId)
      if (!this.appliedOperationIds.has(opId)) {
        const opsToApply = this.replica.applyRemote(operations[i])
        this.appliedOperationIds.add(opId)
        if (this.delegate) this.delegate.applyMany(opsToApply)
      }
    }
  }
}

function opIdToString (opId) {
  return `${opId.site}.${opId.seq}`
}
