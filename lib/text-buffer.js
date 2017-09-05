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

  constructor ({id, uri, text, operations, router, siteId}) {
    this.id = id
    this.siteId = siteId
    this.isHost = (this.siteId === 1)
    this.uri = uri
    this.router = router

    this.replica = new DocumentReplica(siteId)
    this.receivedOperations = []
    this.debugHistory = []
    this.appliedOperationIds = new Set()
    this.subscriptions = new CompositeDisposable()
    this.subscriptions.add(
      this.router.onNotification(`/buffers/${id}`, this.receiveUpdate.bind(this))
    )
    if (this.isHost) {
      this.subscriptions.add(
        this.router.onRequest(`/buffers/${id}`, this.receiveFetch.bind(this))
      )
    }

    if (text) {
      const position = {row: 0, column: 0}
      this.debugHistory.push(['insert', {position, text}])
      const operation = this.replica.insert(position, text)
      this.receivedOperations.push(operation)
      this.appliedOperationIds.add(operation.opId)
    } else if (operations) {
      this.applyRemoteOperations(operations)
    }
  }

  dispose () {
    this.subscriptions.dispose()
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
    if (this.siteId !== 1 && this.delegate) {
      this.delegate.setText(this.replica.getText())
    }
  }

  getDebugInfo () {
    return {
      history: this.debugHistory,
      siteId: this.siteId,
      replicaText: this.replica.getText()
    }
  }

  apply (op) {
    return this.applyMany([op])
  }

  applyMany (operations) {
    const opsToSend = []
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i]
      this.debugHistory.push(['applyLocal', op])
      const opToSend = this.applyLocal(op)
      const opId = opIdToString(opToSend.opId)
      this.appliedOperationIds.add(opId)
      this.receivedOperations.push(opToSend)
      opsToSend.push(serializeOperation(opToSend))
    }

    const updateMessage = new Messages.TextBufferUpdate()
    updateMessage.setOperationsList(opsToSend)
    this.router.notify(`/buffers/${this.id}`, updateMessage.serializeBinary())
  }

  // Private
  applyLocal (operation) {
    switch (operation.type) {
      case 'insert':
        return this.replica.insert(operation.position, operation.text)
      case 'delete':
        return this.replica.delete(operation.position, operation.extent)
      default:
        throw new Error('Unknown operation type ' + operation.type)
    }
  }

  receiveFetch ({requestId}) {
    this.router.respond(requestId, this.serialize().serializeBinary())
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
        this.debugHistory.push(['integrateOperation', op])
        const opsToApply = this.replica.integrateOperation(op)
        this.appliedOperationIds.add(opId)
        this.receivedOperations.push(op)
        if (this.delegate) this.delegate.applyMany(opsToApply)
      }
    }
  }
}

function opIdToString (opId) {
  return `${opId.site}.${opId.seq}`
}
