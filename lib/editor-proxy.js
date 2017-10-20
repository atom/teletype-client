const {CompositeDisposable} = require('event-kit')
const {serializeRemotePosition, deserializeRemotePosition} = require('@atom/tachyon')
const Messages = require('./real-time_pb')
const TetherState = require('./tether-state')

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
    this.tethersBySiteId = new Map()
    if (selections) this.updateSelections(selections, true)

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

  updateSelections (selections = {}, preserveTetherState = false) {
    this.localSelections = selections
    this.updatedLocalSelectionsAt = Date.now()

    let localSelectionsLayerId = this.selectionLayerIdsBySiteId.get(this.siteId)
    if (localSelectionsLayerId == null) {
      localSelectionsLayerId = this.bufferProxy.getNextMarkerLayerId()
      this.selectionLayerIdsBySiteId.set(this.siteId, localSelectionsLayerId)

      const selectionsUpdateMessage = new Messages.EditorProxyUpdate.SelectionsUpdate()
      selectionsUpdateMessage.getSelectionLayerIdsBySiteIdMap().set(this.siteId, localSelectionsLayerId)
      const editorProxyUpdateMessage = new Messages.EditorProxyUpdate()
      editorProxyUpdateMessage.setSelectionsUpdate(selectionsUpdateMessage)

      this.router.notify(`/editors/${this.id}/updates`, editorProxyUpdateMessage.serializeBinary())
    }

    if (this.resolveTetherState() === TetherState.RETRACTED) {
      const deletedSelections = {}
      for (const id in selections) {
        deletedSelections[id] = null
      }
      this.bufferProxy.updateMarkers({
        [localSelectionsLayerId]: deletedSelections
      })
    } else {
      this.bufferProxy.updateMarkers({
        [localSelectionsLayerId]: selections
      })
    }

    if (!preserveTetherState && this.resolveTetherState() === TetherState.RETRACTED) {
      const localCursorPosition = this.getLocalCursorPosition()
      const tetherPosition = this.resolveTetherPosition()
      if (localCursorPosition && tetherPosition && !pointsEqual(localCursorPosition, tetherPosition)) {
        this.setTetherState(TetherState.EXTENDED)
      }
    }
  }

  tetherToSiteId (tetherSiteId) {
    this.setTetherState(TetherState.RETRACTED, tetherSiteId)
  }

  untether () {
    this.setTetherState(TetherState.DISCONNECTED)
  }

  bufferProxyDidUpdateMarkers (markerUpdates) {
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
              if (siteId === this.resolveTetherSiteId()) this.retractOrDisconnectTether()
            }
          }
        }
      }
    }
  }

  retractOrDisconnectTether () {
    const tetherPosition = this.resolveTetherPosition()
    const tetherState = this.resolveTetherState()

    if (!tetherPosition || tetherState === TetherState.DISCONNECTED) {
      return
    } else if (tetherState === TetherState.EXTENDED) {
      if (this.delegate.isPositionVisible(tetherPosition)) return
      if ((Date.now() - this.updatedLocalSelectionsAt) <= this.tetherDisconnectWindow) {
        this.untether()
        return
      }
    }

    this.setTetherState(TetherState.RETRACTED)
  }

  setTetherState (newState, tetherSiteId) {
    if (tetherSiteId == null) {
      tetherSiteId = this.tethersBySiteId.get(this.siteId).siteId
    }

    const previousResolvedState = this.resolveTetherState()

    if (newState === TetherState.DISCONNECTED) {
      this.tethersBySiteId.delete(this.siteId)
    } else {
      this.tethersBySiteId.set(this.siteId, {siteId: tetherSiteId, state: newState})
    }

    if (previousResolvedState === TetherState.RETRACTED || this.resolveTetherState() === TetherState.RETRACTED) {
      this.updateSelections(this.localSelections, true)
    }

    if (this.delegate) {
      this.delegate.updateTether(this.resolveTetherState(), this.resolveTetherPosition())
    }

    const tetherUpdateMessage = new Messages.EditorProxyUpdate.TetherUpdate()
    tetherUpdateMessage.setFollowerSiteId(this.siteId)
    tetherUpdateMessage.setLeaderSiteId(tetherSiteId)
    tetherUpdateMessage.setState(newState)
    const editorProxyUpdateMessage = new Messages.EditorProxyUpdate()
    editorProxyUpdateMessage.setTetherUpdate(tetherUpdateMessage)

    this.router.notify(`/editors/${this.id}/updates`, editorProxyUpdateMessage.serializeBinary())
  }

  didScroll () {
    const tetherPosition = this.resolveTetherPosition()
    if (this.delegate && tetherPosition && !this.delegate.isPositionVisible(tetherPosition)) {
      this.untether()
    }
  }

  getLocalCursorPosition () {
    return this.getSelectionsForSiteId(this.siteId)
  }

  resolveTetherPosition () {
    const tetherSiteId = this.resolveTetherSiteId()
    return tetherSiteId ? this.getSelectionsForSiteId(tetherSiteId) : null
  }

  resolveTetherState () {
    return this.resolveTetherSiteId()
      ? this.tethersBySiteId.get(this.siteId).state
      : TetherState.DISCONNECTED
  }

  resolveTetherSiteId () {
    const tether = this.tethersBySiteId.get(this.siteId)
    if (!tether) return null

    const visitedSiteIds = new Set([this.siteId])
    let tetherSiteId = tether.siteId

    while (true) {
      const nextTether = this.tethersBySiteId.get(tetherSiteId)
      if (visitedSiteIds.has(tetherSiteId)) {
        const minSiteId = Math.min(...Array.from(visitedSiteIds))
        return (minSiteId === this.siteId) ? null : minSiteId
      } else if (nextTether && nextTether.state === TetherState.RETRACTED) {
        visitedSiteIds.add(tetherSiteId)
        tetherSiteId = nextTether.siteId
      } else {
        break
      }
    }

    return tetherSiteId
  }

  getSelectionsForSiteId (siteId) {
    let selections

    if (siteId === this.siteId) {
      selections = this.localSelections
    } else if (this.selectionLayerIdsBySiteId.has(siteId)) {
      const layerId = this.selectionLayerIdsBySiteId.get(siteId)
      selections = this.bufferProxy.getMarkers()[siteId][layerId]
    } else {
      selections = {}
    }

    return lastCursorPositionFromSelections(selections)
  }

  hostDidDisconnect () {
    this.selectionLayerIdsBySiteId.forEach((_, siteId) => {
      this.siteDidDisconnect(siteId)
    })
  }

  siteDidDisconnect (siteId) {
    this.selectionLayerIdsBySiteId.delete(siteId)
    this.tethersBySiteId.delete(siteId)

    if (siteId === this.resolveTetherSiteId()) {
      this.untether()
    }

    if (this.delegate) {
      this.delegate.clearSelectionsForSiteId(siteId)
    }
  }

  receiveFetch ({requestId}) {
    this.router.respond(requestId, this.serialize().serializeBinary())
  }

  receiveUpdate ({message}) {
    const updateMessage = Messages.EditorProxyUpdate.deserializeBinary(message)

    if (updateMessage.hasSelectionsUpdate()) {
      this.receiveSelectionsUpdate(updateMessage.getSelectionsUpdate())
    } else if (updateMessage.hasTetherUpdate()) {
      this.receiveTetherUpdate(updateMessage.getTetherUpdate())
    }
  }

  receiveSelectionsUpdate (selectionsUpdate) {
    selectionsUpdate.getSelectionLayerIdsBySiteIdMap().forEach((layerId, siteId) => {
      this.selectionLayerIdsBySiteId.set(siteId, layerId)
    })
  }

  receiveTetherUpdate (tetherUpdate) {
    const oldLocalTetherSiteId = this.resolveTetherSiteId()

    const followerSiteId = tetherUpdate.getFollowerSiteId()
    const leaderSiteId = tetherUpdate.getLeaderSiteId()
    const tetherState = tetherUpdate.getState()

    if (leaderSiteId == null) {
      this.tethersBySiteId.delete(followerSiteId)
    } else {
      this.tethersBySiteId.set(followerSiteId, {siteId: leaderSiteId, state: tetherState})
    }

    const newLocalTetherSiteId = this.resolveTetherSiteId()
    if (this.delegate && newLocalTetherSiteId !== oldLocalTetherSiteId) {
      this.delegate.updateTether(this.resolveTetherState(), this.resolveTetherPosition())
    }
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
