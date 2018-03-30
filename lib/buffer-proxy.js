const assert = require('assert')
const {CompositeDisposable, Emitter} = require('event-kit')
const {Document, serializeOperation, deserializeOperation} = require('@atom/teletype-crdt')
const Messages = require('./teletype-client_pb')

function doNothing () {}

module.exports =
class BufferProxy {
  static deserialize (message, props) {
    const id = message.getId()
    const uri = message.getUri()
    const operations = message.getOperationsList().map(deserializeOperation)
    return new BufferProxy(Object.assign({id, uri, operations}, props))
  }

  constructor ({id, uri, text, history, operations, router, hostPeerId, siteId, didDispose}) {
    this.id = id
    this.hostPeerId = hostPeerId
    this.siteId = siteId
    this.isHost = (this.siteId === 1)
    this.uri = uri
    this.router = router
    this.emitDidDispose = didDispose || doNothing
    this.document = new Document({siteId, text, history})
    this.nextMarkerLayerId = 1
    this.emitter = new Emitter()
    this.subscriptions = new CompositeDisposable()
    this.subscriptions.add(
      this.router.onNotification(`/buffers/${id}`, this.receiveUpdate.bind(this))
    )
    if (this.isHost) {
      this.subscriptions.add(
        this.router.onRequest(`/buffers/${id}`, this.receiveFetch.bind(this)),
        this.router.onNotification(`/buffers/${id}/save`, this.receiveSave.bind(this))
      )
    } else {
      this.subscriptions.add(
        this.router.onNotification(`/buffers/${id}/pathChange`, this.receivePathChanged.bind(this)),
        this.router.onNotification(`/buffers/${id}/disposal`, this.dispose.bind(this))
      )
    }

    if (operations) this.integrateOperations(operations)
  }

  dispose () {
    this.subscriptions.dispose()
    if (this.delegate) this.delegate.dispose()
    if (this.bufferFile) this.bufferFile.dispose()
    if (this.isHost) this.router.notify({channelId: `/buffers/${this.id}/disposal`})
    this.emitDidDispose()
  }

  serialize () {
    const bufferProxyMessage = new Messages.BufferProxy()
    bufferProxyMessage.setId(this.id)
    bufferProxyMessage.setUri(this.uri)
    bufferProxyMessage.setOperationsList(this.document.getOperations().map(serializeOperation))
    return bufferProxyMessage
  }

  setDelegate (delegate) {
    this.delegate = delegate
    if (this.siteId !== 1 && this.delegate) {
      this.delegate.setText(this.document.getText())
      this.bufferFile = this.delegate.addFile(this)
    }
  }

  getNextMarkerLayerId () {
    return this.nextMarkerLayerId++
  }

  setTextInRange (oldStart, oldEnd, newText) {
    const operations = this.document.setTextInRange(oldStart, oldEnd, newText)
    this.broadcastUpdate(operations)
    this.emitter.emit('did-update-text', {remote: false})
  }

  getMarkers () {
    return this.document.getMarkers()
  }

  updateMarkers (markerUpdatesByLayerId, broadcastUpdate = true) {
    const operations = this.document.updateMarkers(markerUpdatesByLayerId)
    if (broadcastUpdate) this.broadcastUpdate(operations)
    return operations
  }

  onDidUpdateMarkers (listener) {
    return this.emitter.on('did-update-markers', listener)
  }

  onDidUpdateText (listener) {
    return this.emitter.on('did-update-text', listener)
  }

  undo () {
    const undoEntry = this.document.undo()
    if (undoEntry) {
      const {operations, textUpdates, markers} = undoEntry
      this.broadcastUpdate(operations)
      if (textUpdates.length > 0) {
        this.emitter.emit('did-update-text', {remote: false})
      }
      return {textUpdates, markers}
    } else {
      return null
    }
  }

  redo () {
    const redoEntry = this.document.redo()
    if (redoEntry) {
      const {operations, textUpdates, markers} = redoEntry
      this.broadcastUpdate(operations)
      if (textUpdates.length > 0) {
        this.emitter.emit('did-update-text', {remote: false})
      }
      return {textUpdates, markers}
    } else {
      return null
    }
  }

  createCheckpoint (options) {
    return this.document.createCheckpoint(options)
  }

  getChangesSinceCheckpoint (checkpoint) {
    return this.document.getChangesSinceCheckpoint(checkpoint)
  }

  groupChangesSinceCheckpoint (checkpoint, options) {
    return this.document.groupChangesSinceCheckpoint(checkpoint, options)
  }

  groupLastChanges () {
    return this.document.groupLastChanges()
  }

  revertToCheckpoint (checkpoint, options) {
    const result = this.document.revertToCheckpoint(checkpoint, options)
    if (result) {
      const {operations, textUpdates, markers} = result
      this.broadcastUpdate(operations)
      if (textUpdates.length > 0) {
        this.emitter.emit('did-update-text', {remote: false})
      }
      return {textUpdates, markers}
    } else {
      return false
    }
  }

  applyGroupingInterval (groupingInterval) {
    this.document.applyGroupingInterval(groupingInterval)
  }

  getHistory (maxEntries) {
    return this.document.getHistory(maxEntries)
  }

  requestSave () {
    assert(!this.isHost, 'Only guests can request a save')
    this.router.notify({recipientId: this.hostPeerId, channelId: `/buffers/${this.id}/save`})
  }

  requestPathChanged(newUri){
    this.router.notify({channelId: `/buffers/${this.id}/pathChange`, body: newUri })
    this.uri = newUri
  }

  receivePathChanged({body}){
    var newUri = body
    this.uri = newUri
    if(this.bufferFile){
      this.bufferFile.pathChanged()
    }
  }

  receiveFetch ({requestId}) {
    this.router.respond({requestId, body: this.serialize().serializeBinary()})
  }

  receiveUpdate ({body}) {
    const updateMessage = Messages.BufferProxyUpdate.deserializeBinary(body)
    const operations = updateMessage.getOperationsList().map(deserializeOperation)
    this.integrateOperations(operations)
  }

  receiveSave () {
    this.delegate.save()
  }

  broadcastUpdate (operations) {
    const updateMessage = new Messages.BufferProxyUpdate()
    updateMessage.setOperationsList(operations.map(serializeOperation))
    this.router.notify({channelId: `/buffers/${this.id}`, body: updateMessage.serializeBinary()})
  }

  integrateOperations (operations) {
    const {textUpdates, markerUpdates} = this.document.integrateOperations(operations)
    if (this.delegate) this.delegate.updateText(textUpdates)
    this.emitter.emit('did-update-markers', markerUpdates)
    if (textUpdates.length > 0) {
      this.emitter.emit('did-update-text', {remote: true})
    }
  }
}
