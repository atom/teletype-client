const {CompositeDisposable} = require('event-kit')
const {serializeRemotePosition, deserializeRemotePosition} = require('@atom/tachyon')
const Messages = require('./real-time_pb')

module.exports =
class TextEditor {
  static async deserialize (message, props) {
    const id = message.getId()
    const textBufferId = message.getTextBufferId()
    const textBuffer = props.textBuffersById.get(id)
    const selectionMarkerLayersBySiteId = new Map()
    const selectionMarkerLayersBySiteIdMessage = message.getSelectionMarkerLayersBySiteIdMap()
    for (const [siteId, markerLayerMessage] of selectionMarkerLayersBySiteIdMessage.entries()) {
      const markerLayer = await deserializeMarkerLayer(markerLayerMessage, textBuffer.replica)
      selectionMarkerLayersBySiteId.set(siteId, markerLayer)
    }

    return new TextEditor(Object.assign({id, textBuffer, selectionMarkerLayersBySiteId}, props))
  }

  constructor ({id, textBuffer, selectionMarkerLayersBySiteId, selectionRanges, router, siteId}) {
    this.id = id
    this.siteId = siteId
    this.isHost = (this.siteId === 1)
    this.textBuffer = textBuffer
    this.router = router
    this.selectionMarkerLayersBySiteId = selectionMarkerLayersBySiteId || new Map()
    if (selectionRanges) {
      this.selectionMarkerLayersBySiteId.set(siteId, selectionRanges)
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
    if (this.subscriptions) this.subscriptions.dispose()
    if (this.textBuffer) this.textBuffer.dispose()
  }

  serialize () {
    const editorMessage = new Messages.TextEditor()
    editorMessage.setId(this.id)
    editorMessage.setTextBufferId(this.textBuffer.id)
    const selectionMarkerLayersBySiteIdMessage = editorMessage.getSelectionMarkerLayersBySiteIdMap()
    this.selectionMarkerLayersBySiteId.forEach((markerLayer, siteId) => {
      selectionMarkerLayersBySiteIdMessage.set(siteId, serializeMarkerLayer(markerLayer, this.textBuffer.replica))
    })
    return editorMessage
  }

  setDelegate (delegate) {
    this.delegate = delegate
    this.selectionMarkerLayersBySiteId.forEach((markerLayer, siteId) => {
      if (siteId !== this.siteId) {
        this.delegate.setSelectionMarkerLayerForSiteId(siteId, markerLayer)
      }
    })
  }

  setSelectionRanges (selectionRanges) {
    const updateMessage = new Messages.TextEditorUpdate()
    updateMessage.setSelectionMarkerLayerSiteId(this.siteId)
    updateMessage.setSelectionMarkerLayer(serializeMarkerLayer(selectionRanges, this.textBuffer.replica))
    this.router.notify(`/editors/${this.id}`, updateMessage.serializeBinary())

    this.selectionMarkerLayersBySiteId.set(this.siteId, selectionRanges)
  }

  hostDidDisconnect () {
    this.selectionMarkerLayersBySiteId.forEach((_, siteId) => {
      this.siteDidDisconnect(siteId)
    })
  }

  siteDidDisconnect (siteId) {
    this.selectionMarkerLayersBySiteId.delete(siteId)
    this.delegate.setSelectionMarkerLayerForSiteId(siteId, null)
  }

  receiveFetch ({requestId}) {
    this.router.respond(requestId, this.serialize().serializeBinary())
  }

  async receiveUpdate ({message}) {
    const updateMessage = Messages.TextEditorUpdate.deserializeBinary(message)
    const selectionMarkerLayerSiteId = updateMessage.getSelectionMarkerLayerSiteId()
    const selectionMarkerLayer = await deserializeMarkerLayer(
      updateMessage.getSelectionMarkerLayer(),
      this.textBuffer.replica
    )
    this.selectionMarkerLayersBySiteId.set(selectionMarkerLayerSiteId, selectionMarkerLayer)
    this.delegate.setSelectionMarkerLayerForSiteId(selectionMarkerLayerSiteId, selectionMarkerLayer)
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
