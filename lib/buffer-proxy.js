const {CompositeDisposable, Emitter} = require('event-kit')
const {DocumentHistory, serializeOperation, deserializeOperation} = require('@atom/tachyon')
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

    this.history = new DocumentHistory(siteId)
    this.receivedOperations = []
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
    }

    if (text) {
      const position = {row: 0, column: 0}
      const operations = this.history.setTextInRange(position, position, text)
      for (let i = 0; i < operations.length; i++) {
        const operation = operations[i]
        this.receivedOperations.push(operation)
      }
    } else if (operations) {
      this.integrateOperations(operations)
    }
  }

  dispose () {
    this.subscriptions.dispose()
  }

  serialize () {
    const bufferProxyMessage = new Messages.BufferProxy()
    bufferProxyMessage.setId(this.id)
    bufferProxyMessage.setUri(this.uri)
    bufferProxyMessage.setOperationsList(this.receivedOperations.map(serializeOperation))
    return bufferProxyMessage
  }

  setDelegate (delegate) {
    this.delegate = delegate
    if (this.siteId !== 1 && this.delegate) {
      this.delegate.setText(this.history.getText())
    }
  }

  getNextMarkerLayerId () {
    return this.nextMarkerLayerId++
  }

  setTextInRange (oldStart, oldEnd, newText) {
    const operations = this.history.setTextInRange(oldStart, oldEnd, newText)

    this.receivedOperations.push(...operations)

    const updateMessage = new Messages.BufferProxyUpdate()
    updateMessage.setOperationsList(operations.map(serializeOperation))
    this.router.notify(`/buffers/${this.id}`, updateMessage.serializeBinary())
  }
  
  getMarkers () {
    return this.history.getMarkers()
  }

  updateMarkers (markerUpdatesByLayerId) {
    const operations = this.history.updateMarkers(markerUpdatesByLayerId)
    this.receivedOperations.push(...operations)

    const updateMessage = new Messages.BufferProxyUpdate()
    updateMessage.setOperationsList(operations.map(serializeOperation))
    this.router.notify(`/buffers/${this.id}`, updateMessage.serializeBinary())

    return operations
  }

  onDidUpdateMarkers (listener) {
    return this.emitter.on('did-update-markers', listener)
  }

  apply (op) {
    return this.applyMany([op])
  }

  receiveFetch ({requestId}) {
    this.router.respond(requestId, this.serialize().serializeBinary())
  }

  receiveUpdate ({message}) {
    const updateMessage = Messages.BufferProxyUpdate.deserializeBinary(message)
    const operations = updateMessage.getOperationsList().map(deserializeOperation)
    this.integrateOperations(operations)
  }

  integrateOperations (operations) {
    this.receivedOperations.push(...operations)
    const {textUpdates, markerUpdates} = this.history.integrateOperations(operations)
    if (this.delegate) this.delegate.updateText(textUpdates)
    this.emitter.emit('did-update-markers', markerUpdates)
  }
}
