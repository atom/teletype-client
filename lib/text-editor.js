const {serializeRemotePosition, deserializeRemotePosition} = require('@atom/tachyon')
const Messages = require('./real-time_pb')

module.exports =
class TextEditor {

  static deserialize (message, props) {
    const id = message.getId()
    const textBufferId = message.getTextBufferId()
    const textBuffer = props.textBuffersById.get(id)

    return new TextEditor(Object.assign({id, textBuffer}, props))
  }

  constructor ({id, textBuffer, router, siteId}) {
    this.id = id
    this.siteId = siteId
    this.textBuffer = textBuffer
    this.router = router
    this.selectionMarkerLayersBySiteId = {}
  }

  dispose () {
    if (this.subscription) this.subscription.dispose()
    if (this.textBuffer) this.textBuffer.dispose()
  }

  serialize () {
    const editorMessage = new Messages.TextEditor()
    editorMessage.setTextBufferId(this.textBuffer.id)
    return editorMessage
  }

  setDelegate (delegate) {
    this.delegate = delegate
    for (let siteId in this.selectionMarkerLayersBySiteId) {
      siteId = Number(siteId)
      if (siteId !== this.siteId) {
        this.delegate.setSelectionMarkerLayerForSiteId(
          siteId,
          this.selectionMarkerLayersBySiteId[siteId]
        )
      }
    }
  }

  setSelectionRanges (selectionRanges) {
    // this.serializeMarkerRanges(selectionRanges),
  }

  serializeMarkerRanges (localRanges) {
    const remoteMarkerRanges = {}
    for (const id in localRanges) {
      const {start, end} = localRanges[id]
      remoteMarkerRanges[id] = {
        start: this.serializeRemotePosition(start),
        end: this.serializeRemotePosition(end)
      }
    }
    return JSON.stringify(remoteMarkerRanges)
  }

  async deserializeMarkerRanges (serializedRemoteRanges) {
    const remoteRanges = JSON.parse(serializedRemoteRanges)
    const localRanges = {}
    for (const id in remoteRanges) {
      const {start, end} = remoteRanges[id]
      localRanges[id] = {
        start: await this.deserializeRemotePosition(start),
        end: await this.deserializeRemotePosition(end)
      }
    }
    return localRanges
  }

  serializeRemotePosition (remotePosition) {
    return new Buffer(serializeRemotePosition(
      this.sharedBuffer.replica.getRemotePosition(remotePosition)
    )).toString('base64')
  }

  deserializeRemotePosition (data) {
    return this.sharedBuffer.replica.getLocalPosition(
      deserializeRemotePosition(new Buffer(data, 'base64'))
    )
  }
}
