const {CompositeDisposable} = require('event-kit')
const {serializeRemotePosition, deserializeRemotePosition} = require('@atom/tachyon')
const Messages = require('./real-time_pb')

const RETRACTED = 'retracted'
const EXTENDED = 'extended'
const DISCONNECTED = 'disconnected'

function doNothing () {}

module.exports =
class EditorProxy {
  static deserialize (message, props) {
    const id = message.getId()
    const bufferProxyId = message.getBufferProxyId()
    const bufferProxy = props.bufferProxiesById.get(bufferProxyId)
    const selectionLayerIdsBySiteId = new Map()
    message.getSelectionLayerIdsBySiteIdMap().forEach((layerId, siteId) => {
      selectionLayerIdsBySiteId.set(siteId, layerId)
    })
    return new EditorProxy(Object.assign({id, bufferProxy, selectionLayerIdsBySiteId}, props))
  }

  constructor ({id, bufferProxy, selectionLayerIdsBySiteId, selections, router, siteId, tetherDisconnectWindow, didDispose}) {
    this.id = id
    this.siteId = siteId
    this.isHost = (this.siteId === 1)
    this.bufferProxy = bufferProxy
    this.router = router
    this.tetherDisconnectWindow = tetherDisconnectWindow
    this.emitDidDispose = didDispose || doNothing
    this.selectionLayerIdsBySiteId = selectionLayerIdsBySiteId || new Map()
    if (selections) {
      this.updateSelections(selections)
    }

    this.subscriptions = new CompositeDisposable()
    this.subscriptions.add(
      this.bufferProxy.onDidUpdateMarkers(this.bufferProxyDidUpdateMarkers.bind(this))
    )
    this.subscriptions.add(
      this.router.onNotification(`/editors/${id}/updates`, this.receiveUpdate.bind(this))
    )
    if (this.isHost) {
      this.subscriptions.add(
        this.router.onRequest(`/editors/${id}`, this.receiveFetch.bind(this))
      )
    } else {
      this.subscriptions.add(
        this.router.onNotification(`/editors/${id}/disposal`, this.dispose.bind(this))
      )
    }
  }

  dispose () {
    this.subscriptions.dispose()
    if (this.delegate) this.delegate.dispose()
    if (this.isHost) this.router.notify(`/editors/${this.id}/disposal`)
    this.emitDidDispose()
  }

  serialize () {
    const editorMessage = new Messages.EditorProxy()
    editorMessage.setId(this.id)
    editorMessage.setBufferProxyId(this.bufferProxy.id)
    const selectionLayerIdsBySiteIdMessage = editorMessage.getSelectionLayerIdsBySiteIdMap()
    this.selectionLayerIdsBySiteId.forEach((layerId, siteId) => {
      selectionLayerIdsBySiteIdMessage.set(siteId, layerId)
    })
    return editorMessage
  }

  setDelegate (delegate) {
    this.delegate = delegate

    if (this.delegate) {
      this.bufferProxyDidUpdateMarkers(this.bufferProxy.getMarkers())
    }
  }

  updateSelections (selections, initialUpdate = false) {
    this.updatedLocalSelectionsAt = Date.now()

    let localSelectionsLayerId = this.selectionLayerIdsBySiteId.get(this.siteId)
    if (localSelectionsLayerId == null) {
      localSelectionsLayerId = this.bufferProxy.getNextMarkerLayerId()
      this.selectionLayerIdsBySiteId.set(this.siteId, localSelectionsLayerId)

      const editorProxyUpdateMessage = new Messages.EditorProxyUpdate()
      editorProxyUpdateMessage.getSelectionLayerIdsBySiteIdMap().set(this.siteId, localSelectionsLayerId)
      this.router.notify(`/editors/${this.id}/updates`, editorProxyUpdateMessage.serializeBinary())
    }
    this.bufferProxy.updateMarkers({
      [localSelectionsLayerId]: selections
    })

    if (!initialUpdate && this.tetherState === RETRACTED) {
      const localCursorPosition = this.getLocalCursorPosition()
      const tetherPosition = this.getTetherPosition()
      if (localCursorPosition && !pointsEqual(localCursorPosition, tetherPosition)) {
        this.tetherState = EXTENDED
      }
    }
  }

  tetherToSiteId (tetherSiteId) {
    this.tetherSiteId = tetherSiteId
    this.tetherState = RETRACTED
    if (this.delegate) this.updateTether()
  }

  getTetherSiteId () {
    return this.tetherSiteId
  }

  getTetherState () {
    return this.tetherState
  }

  bufferProxyDidUpdateMarkers (markerUpdates) {
    if (global.debug) {
      console.log(this.siteId, markerUpdates);
      debugger
    }

    if (this.delegate) {
      for (let siteId in markerUpdates) {
        siteId = parseInt(siteId)
        if (siteId !== this.siteId) {
          const layersById = markerUpdates[siteId]
          for (let layerId in layersById) {
            layerId = parseInt(layerId)
            if (this.selectionLayerIdsBySiteId.get(siteId) === layerId) {
              const selections = layersById[layerId]
              this.delegate.updateSelectionsForSiteId(siteId, selections)
              if (siteId === this.tetherSiteId) this.updateTether()
            }
          }
        }
      }
    }
  }

  updateTether () {
    const cursorPosition = this.getTetherPosition()

    if (!cursorPosition) return
    if (this.tetherState === DISCONNECTED) {
      return
    } else if (this.tetherState === EXTENDED) {
      if (this.delegate.isPositionVisible(cursorPosition)) return
      if ((Date.now() - this.updatedLocalSelectionsAt) <= this.tetherDisconnectWindow) return
    }
    this.delegate.updateTether(cursorPosition)
    this.tetherState = RETRACTED
  }

  getLocalCursorPosition () {
    const localSelectionsLayerId = this.selectionLayerIdsBySiteId.get(this.siteId)
    const localSelections = this.bufferProxy.getMarkers()[this.siteId][localSelectionsLayerId]
    return lastCursorPositionFromSelections(localSelections)
  }

  getTetherPosition () {
    const leaderSelectionsLayerId = this.selectionLayerIdsBySiteId.get(this.tetherSiteId)
    const leaderSelections = this.bufferProxy.getMarkers()[this.tetherSiteId][leaderSelectionsLayerId]
    return lastCursorPositionFromSelections(leaderSelections)
  }

  setLocalViewport (startRow, endRow) {
    this.localViewport = {startRow, endRow}
  }

  hostDidDisconnect () {
    this.selectionLayerIdsBySiteId.forEach((_, siteId) => {
      this.siteDidDisconnect(siteId)
    })
  }

  siteDidDisconnect (siteId) {
    this.selectionLayerIdsBySiteId.delete(siteId)
    if (siteId === this.tetherSiteId) {
      this.tetherState = DISCONNECTED
    }
    if (this.delegate) {
      this.delegate.clearSelectionsForSiteId(siteId)
    }
  }

  receiveFetch ({requestId}) {
    this.router.respond(requestId, this.serialize().serializeBinary())
  }

  async receiveUpdate ({message}) {
    const updateMessage = Messages.EditorProxyUpdate.deserializeBinary(message)
    updateMessage.getSelectionLayerIdsBySiteIdMap().forEach((layerId, siteId) => {
      this.selectionLayerIdsBySiteId.set(siteId, layerId)
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

function lastCursorPositionFromSelections (selections) {
  const selectionIds = Object.keys(selections).map((key) => parseInt(key))
  if (selectionIds.length > 0) {
    const lastSelection = selections[Math.max(...selectionIds)]
    return lastSelection.reversed ? lastSelection.range.start : lastSelection.range.end
  }
}

function pointsEqual (a, b) {
  return a.row === b.row && a.column === b.column
}
