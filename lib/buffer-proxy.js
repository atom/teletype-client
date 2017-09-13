const {CompositeDisposable, Emitter} = require('event-kit')
const {Document, serializeOperation, deserializeOperation} = require('@atom/tachyon')
const Messages = require('./real-time_pb')

module.exports =
class BufferProxy {
  static deserialize (message, props) {
    const id = message.getId()
    const uri = message.getUri()
    const operations = message.getOperationsList().map(deserializeOperation)
    return new BufferProxy(Object.assign({id, uri, operations}, props))
  }

  constructor ({id, uri, text, operations, router, siteId}) {
    this.id = id
    this.siteId = siteId
    this.isHost = (this.siteId === 1)
    this.uri = uri
    this.router = router

    this.document = new Document(siteId)
    this.operations = []
    this.nextMarkerLayerId = 1
    this.emitter = new Emitter()
    this.subscriptions = new CompositeDisposable()
    this.subscriptions.add(
      this.router.onNotification(`/buffers/${id}`, this.receiveUpdate.bind(this))
    )
    if (this.isHost) {
      this.subscriptions.add(
        this.router.onRequest(`/buffers/${id}`, this.receiveFetch.bind(this))
      )
    } else {
      this.subscriptions.add(
        this.router.onNotification(`/buffers/${id}/disposal`, this.dispose.bind(this))
      )
    }

    if (text) {
      const position = {row: 0, column: 0}
      const operations = this.document.setTextInRange(position, position, text)
      for (let i = 0; i < operations.length; i++) {
        const operation = operations[i]
        this.operations.push(operation)
      }
    } else if (operations) {
      this.integrateOperations(operations)
    }
  }

  dispose () {
    this.subscriptions.dispose()
    if (this.delegate) this.delegate.dispose()
    if (this.isHost) this.router.notify(`/buffers/${this.id}/disposal`)
  }

  serialize () {
    const bufferProxyMessage = new Messages.BufferProxy()
    bufferProxyMessage.setId(this.id)
    bufferProxyMessage.setUri(this.uri)
    bufferProxyMessage.setOperationsList(this.operations.map(serializeOperation))
    return bufferProxyMessage
  }

  setDelegate (delegate) {
    this.delegate = delegate
    if (this.siteId !== 1 && this.delegate) {
      this.delegate.setText(this.document.getText())
    }
  }

  getNextMarkerLayerId () {
    return this.nextMarkerLayerId++
  }

  setTextInRange (oldStart, oldEnd, newText) {
    const operations = this.document.setTextInRange(oldStart, oldEnd, newText)
    this.operations.push(...operations)
    this.broadcastUpdate(operations)
  }

  getMarkers () {
    return this.document.getMarkers()
  }

  updateMarkers (markerUpdatesByLayerId) {
    const operations = this.document.updateMarkers(markerUpdatesByLayerId)
    this.operations.push(...operations)
    this.broadcastUpdate(operations)
    return operations
  }

  onDidUpdateMarkers (listener) {
    return this.emitter.on('did-update-markers', listener)
  }

  undo () {
    const {operations, textUpdates, markers} = this.document.undo()
    this.broadcastUpdate(operations)
    return {textUpdates, markers}
  }

  redo () {
    const {operations, textUpdates, markers} = this.document.redo()
    this.broadcastUpdate(operations)
    return {textUpdates, markers}
  }

  createCheckpoint (options) {
    return this.document.createCheckpoint(options)
  }

  groupChangesSinceCheckpoint (checkpoint, options) {
    return this.document.groupChangesSinceCheckpoint(checkpoint, options)
  }

  applyGroupingInterval (groupingInterval) {
    this.document.applyGroupingInterval(groupingInterval)
  }

  receiveFetch ({requestId}) {
    this.router.respond(requestId, this.serialize().serializeBinary())
  }

  receiveUpdate ({message}) {
    const updateMessage = Messages.BufferProxyUpdate.deserializeBinary(message)
    const operations = updateMessage.getOperationsList().map(deserializeOperation)
    this.integrateOperations(operations)
  }

  broadcastUpdate (operations) {
    const updateMessage = new Messages.BufferProxyUpdate()
    updateMessage.setOperationsList(operations.map(serializeOperation))
    this.router.notify(`/buffers/${this.id}`, updateMessage.serializeBinary())
  }

  integrateOperations (operations) {
    this.operations.push(...operations)
    const {textUpdates, markerUpdates} = this.document.integrateOperations(operations)
    if (this.delegate) this.delegate.updateText(textUpdates)
    this.emitter.emit('did-update-markers', markerUpdates)
  }
}
