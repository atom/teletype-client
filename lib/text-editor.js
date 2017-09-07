const {CompositeDisposable} = require('event-kit')
const {serializeRemotePosition, deserializeRemotePosition} = require('@atom/tachyon')
const Messages = require('./real-time_pb')

module.exports =
class TextEditor {
  static async deserialize (message, props) {
    const id = message.getId()
    const textBufferId = message.getTextBufferId()
    const textBuffer = props.textBuffersById.get(id)
    const selectionLayerIdsBySiteId = new Map()
    message.getSelectionLayerIdsBySiteIdMap().forEach((layerId, siteId) => {
      selectionLayerIdsBySiteId.set(siteId, layerId)
    })
    return new TextEditor(Object.assign({id, textBuffer, selectionLayerIdsBySiteId}, props))
  }

  constructor ({id, textBuffer, selectionLayerIdsBySiteId, selections, router, siteId}) {
    this.id = id
    this.siteId = siteId
    this.isHost = (this.siteId === 1)
    this.textBuffer = textBuffer
    this.router = router

    this.selectionLayerIdsBySiteId = selectionLayerIdsBySiteId || new Map()
    if (selections) {
      this.updateSelections(selections)
    }

    this.subscriptions = new CompositeDisposable()
    this.subscriptions.add(
      this.router.onNotification(`/editors/${id}`, this.receiveUpdate.bind(this))
    )
    if (this.isHost) {
      this.subscriptions.add(
        this.router.onRequest(`/editors/${id}`, this.receiveFetch.bind(this))
      )
    }
  }

  dispose () {
    this.subscriptions.dispose()
  }

  serialize () {
    const editorMessage = new Messages.TextEditor()
    editorMessage.setId(this.id)
    editorMessage.setTextBufferId(this.textBuffer.id)
    const selectionLayerIdsBySiteIdMessage = editorMessage.getSelectionLayerIdsBySiteIdMap()
    this.selectionLayerIdsBySiteId.forEach((layerId, siteId) => {
      selectionLayerIdsBySiteIdMessage.set(siteId, layerId)
    })
    return editorMessage
  }

  setDelegate (delegate) {
    this.delegate = delegate

    if (this.delegate) {
      this.selectionLayerIdsBySiteId.forEach((layerId, siteId) => {
        if (siteId !== this.siteId) {
          this.delegate.setSelectionLayerIdForSiteId(siteId, layerId)
        }
      })
    }
  }

  updateSelections (selections) {
    let localSelectionsLayerId = this.selectionLayerIdsBySiteId.get(this.siteId)
    if (localSelectionsLayerId == null) {
      localSelectionsLayerId = this.textBuffer.getNextMarkerLayerId()
      this.selectionLayerIdsBySiteId.set(this.siteId, localSelectionsLayerId)

      const textEditorUpdateMessage = new Messages.TextEditorUpdate()
      textEditorUpdateMessage.getSelectionLayerIdsBySiteIdMap().set(this.siteId, localSelectionsLayerId)
      this.router.notify(`/editors/${this.id}`, textEditorUpdateMessage.serializeBinary())
    }
    this.textBuffer.updateMarkers({
      [localSelectionsLayerId]: selections
    })
  }

  hostDidDisconnect () {
    this.selectionLayerIdsBySiteId.forEach((_, siteId) => {
      this.siteDidDisconnect(siteId)
    })
  }

  siteDidDisconnect (siteId) {
    this.selectionLayerIdsBySiteId.delete(siteId)
    if (this.delegate) {
      this.delegate.setSelectionLayerIdForSiteId(siteId, null)
    }
  }

  receiveFetch ({requestId}) {
    this.router.respond(requestId, this.serialize().serializeBinary())
  }

  async receiveUpdate ({message}) {
    const updateMessage = Messages.TextEditorUpdate.deserializeBinary(message)
    updateMessage.getSelectionLayerIdsBySiteIdMap().forEach((layerId, siteId) => {
      this.selectionLayerIdsBySiteId.set(siteId, layerId)
      if (this.delegate) this.delegate.setSelectionLayerIdForSiteId(siteId, layerId)
    })
  }
}

function serializeMarkerLayer (markerRangesById, replica) {
  const markerMessages = []

  for (const id in markerRangesById) {
    const {start, end} = markerRangesById[id]
    const markerMessage = new Messages.Marker()
    markerMessage.setId(id)
    markerMessage.setStart(serializeRemotePosition(replica.getRemotePosition(start)))
    markerMessage.setEnd(serializeRemotePosition(replica.getRemotePosition(end)))
    markerMessages.push(markerMessage)
  }

  const markerLayerMessage = new Messages.MarkerLayer()
  markerLayerMessage.setMarkersList(markerMessages)

  return markerLayerMessage
}

async function deserializeMarkerLayer (markerLayerMessage, replica) {
  const markerRangesById = {}

  const markerMessages = markerLayerMessage.getMarkersList()
  for (let i = 0; i < markerMessages.length; i++) {
    const markerMessage = markerMessages[i]
    markerRangesById[markerMessage.getId()] = {
      start: await replica.getLocalPosition(deserializeRemotePosition(markerMessage.getStart())),
      end: await replica.getLocalPosition(deserializeRemotePosition(markerMessage.getEnd()))
    }
  }

  return markerRangesById
}
