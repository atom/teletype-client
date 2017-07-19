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

  constructor ({portalId, id, textBuffer, selectionMarkerLayersBySiteId, selectionRanges, router, siteId}) {
    this.portalId = portalId
    this.id = id
    this.siteId = siteId
    this.textBuffer = textBuffer
    this.router = router
    this.selectionMarkerLayersBySiteId = selectionMarkerLayersBySiteId || new Map()
    if (selectionRanges) {
      this.selectionMarkerLayersBySiteId.set(siteId, selectionRanges)
    }

    this.subscriptions = new CompositeDisposable()
    this.subscriptions.add(
      this.router.onNotification(`/portals/${this.portalId}/editors/${this.id}`, this.receiveUpdate.bind(this))
    )
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
    this.router.notify(`/portals/${this.portalId}/editors/${this.id}`, updateMessage.serializeBinary())
  }

  async receiveUpdate ({message}) {
    const updateMessage = Messages.TextEditorUpdate.deserializeBinary(message)
    const selectionMarkerLayerSiteId = updateMessage.getSelectionMarkerLayerSiteId()
    const selectionMarkerLayer = await deserializeMarkerLayer(
      updateMessage.getSelectionMarkerLayer(),
      this.textBuffer.replica
    )
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
