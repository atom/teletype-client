const {CompositeDisposable} = require('event-kit')
const {serializeRemotePosition, deserializeRemotePosition} = require('@atom/teletype-crdt')
const Messages = require('./teletype-client_pb')
const FollowState = require('./follow-state')
const NullEditorProxyDelegate = require('./null-editor-proxy-delegate')

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

    const tethersByFollowerId = new Map()
    message.getTethersByFollowerIdMap().forEach((tetherMessage, followerId) => {
      tethersByFollowerId.set(followerId, {
        leaderId: tetherMessage.getLeaderSiteId(),
        state: tetherMessage.getState()
      })
    })

    return new EditorProxy(Object.assign({id, bufferProxy, selectionLayerIdsBySiteId, tethersByFollowerId}, props))
  }

  constructor ({id, bufferProxy, selectionLayerIdsBySiteId, tethersByFollowerId, selections, router, siteId, tetherDisconnectWindow, didDispose}) {
    this.id = id
    this.siteId = siteId
    this.isHost = (this.siteId === 1)
    this.bufferProxy = bufferProxy
    this.router = router
    this.tetherDisconnectWindow = tetherDisconnectWindow
    this.emitDidDispose = didDispose || doNothing
    this.selectionLayerIdsBySiteId = selectionLayerIdsBySiteId || new Map()
    this.localHiddenSelectionsLayerId = bufferProxy.getNextMarkerLayerId()
    this.tethersByFollowerId = tethersByFollowerId || new Map()
    this.delegate = new NullEditorProxyDelegate()
    if (selections) this.updateSelections(selections, true)

    this.subscriptions = new CompositeDisposable()
    this.subscriptions.add(
      this.bufferProxy.onDidUpdateText(this.bufferProxyDidUpdateText.bind(this)),
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
    this.delegate.dispose()
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

    const tethersByFollowerIdMessage = editorMessage.getTethersByFollowerIdMap()
    this.tethersByFollowerId.forEach((tether, followerId) => {
      const tetherMessage = new Messages.EditorProxy.Tether()
      tetherMessage.setLeaderSiteId(tether.leaderId)
      tetherMessage.setState(tether.state)
      tethersByFollowerIdMessage.set(followerId, tetherMessage)
    })

    return editorMessage
  }

  setDelegate (delegate) {
    this.delegate = delegate || new NullEditorProxyDelegate()
    this.bufferProxyDidUpdateMarkers(this.bufferProxy.getMarkers())
  }

  updateSelections (selections = {}, preserveFollowState = false) {
    this.lastLocalUpdateAt = Date.now()
    this.bufferProxy.updateMarkers({
      [this.localHiddenSelectionsLayerId]: selections
    }, false)

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

    const newFollowState = this.resolveFollowState()
    if (newFollowState === FollowState.RETRACTED) {
      if (this.oldFollowState !== FollowState.RETRACTED) {
        const deletedSelections = {}
        for (const id in selections) {
          deletedSelections[id] = null
        }
        this.bufferProxy.updateMarkers({
          [localSelectionsLayerId]: deletedSelections
        })
      }
    } else {
      this.bufferProxy.updateMarkers({
        [localSelectionsLayerId]: selections
      })
    }
    this.oldFollowState = newFollowState

    if (!preserveFollowState && newFollowState === FollowState.RETRACTED) {
      const localCursorPosition = this.cursorPositionForSiteId(this.siteId)
      const leaderPosition = this.resolveLeaderPosition()
      if (localCursorPosition && leaderPosition && !pointsEqual(localCursorPosition, leaderPosition)) {
        this.setFollowState(FollowState.EXTENDED)
      }
    }

    this.updateActivePositions()
  }

  follow (leaderSiteId) {
    this.setFollowState(FollowState.RETRACTED, leaderSiteId)
  }

  unfollow () {
    this.setFollowState(FollowState.DISCONNECTED)
  }

  getFollowedSiteId () {
    if (this.resolveFollowState() === FollowState.DISCONNECTED) {
      return null
    } else {
      return this.tethersByFollowerId.get(this.siteId).leaderId
    }
  }

  bufferProxyDidUpdateMarkers (markerUpdates) {
    for (let siteId in markerUpdates) {
      siteId = parseInt(siteId)
      if (siteId !== this.siteId) {
        const layersById = markerUpdates[siteId]
        for (let layerId in layersById) {
          layerId = parseInt(layerId)
          if (this.selectionLayerIdsBySiteId.get(siteId) === layerId) {
            const selections = layersById[layerId]
            this.delegate.updateSelectionsForSiteId(siteId, selections)
            if (siteId === this.resolveLeaderSiteId()) this.retractOrDisconnectTether()
          }
        }
      }
    }

    this.updateActivePositions()
  }

  bufferProxyDidUpdateText ({remote}) {
    if (this.resolveFollowState() === FollowState.RETRACTED) {
      if (remote) {
        const leaderPosition = this.resolveLeaderPosition()
        if (leaderPosition) {
          this.delegate.updateTether(FollowState.RETRACTED, leaderPosition)
        }
      } else {
        this.lastLocalUpdateAt = Date.now()
        this.setFollowState(FollowState.EXTENDED)
      }
    }

    this.updateActivePositions()
  }

  retractOrDisconnectTether () {
    const leaderPosition = this.resolveLeaderPosition()
    const followState = this.resolveFollowState()

    if (!leaderPosition || followState === FollowState.DISCONNECTED) {
      return
    } else if (followState === FollowState.EXTENDED) {
      if (this.delegate.isPositionVisible(leaderPosition)) return
      if ((Date.now() - this.lastLocalUpdateAt) <= this.tetherDisconnectWindow) {
        this.unfollow()
        return
      }
    }

    this.setFollowState(FollowState.RETRACTED)
  }

  setFollowState (newState, newLeaderId) {
    const tether = this.tethersByFollowerId.get(this.siteId)
    const oldState = tether ? tether.state : null
    const oldResolvedState = this.resolveFollowState()
    const oldLeaderId = tether ? tether.leaderId : null
    newLeaderId = newLeaderId == null ? oldLeaderId : newLeaderId
    if (newLeaderId == null) return

    this.tethersByFollowerId.set(this.siteId, {leaderId: newLeaderId, state: newState})

    const newResolvedState = this.resolveFollowState()

    if (oldResolvedState === FollowState.RETRACTED || newResolvedState === FollowState.RETRACTED) {
      this.updateSelections(this.getLocalHiddenSelections(), true)
    }

    const leaderPosition = this.resolveLeaderPosition()
    if (leaderPosition) this.delegate.updateTether(newResolvedState, leaderPosition)

    if (oldState !== newState || oldLeaderId !== newLeaderId) {
      const tetherUpdateMessage = new Messages.EditorProxyUpdate.TetherUpdate()
      tetherUpdateMessage.setFollowerSiteId(this.siteId)
      tetherUpdateMessage.setLeaderSiteId(newLeaderId)
      tetherUpdateMessage.setState(newState)
      const editorProxyUpdateMessage = new Messages.EditorProxyUpdate()
      editorProxyUpdateMessage.setTetherUpdate(tetherUpdateMessage)

      this.router.notify(`/editors/${this.id}/updates`, editorProxyUpdateMessage.serializeBinary())
    }
  }

  didScroll () {
    const leaderPosition = this.resolveLeaderPosition()
    if (leaderPosition && !this.delegate.isPositionVisible(leaderPosition)) {
      this.unfollow()
    }
  }

  updateActivePositions () {
    const activePositions = {}
    this.selectionLayerIdsBySiteId.forEach((_, siteId) => {
      if (siteId !== this.siteId) {
        let position
        if (this.resolveFollowState(siteId) === FollowState.RETRACTED) {
          position = this.resolveLeaderPosition(siteId)
        } else {
          position = this.cursorPositionForSiteId(siteId)
        }

        if (position) activePositions[siteId] = position
      }
    })

    this.delegate.updateActivePositions(activePositions)
  }

  resolveLeaderPosition (followerId = this.siteId) {
    return this.cursorPositionForSiteId(this.resolveLeaderSiteId(followerId))
  }

  resolveFollowState (followerId = this.siteId) {
    const leaderId = this.resolveLeaderSiteId(followerId)
    if (followerId === leaderId) {
      return FollowState.DISCONNECTED
    } else {
      return this.tethersByFollowerId.get(followerId).state
    }
  }

  resolveLeaderSiteId (followerId = this.siteId) {
    const tether = this.tethersByFollowerId.get(followerId)
    if (!tether) return followerId

    const visitedSiteIds = new Set([followerId])
    let leaderId = tether.leaderId

    let nextTether = this.tethersByFollowerId.get(leaderId)
    while (nextTether && nextTether.state === FollowState.RETRACTED) {
      if (visitedSiteIds.has(leaderId)) {
        leaderId = Math.min(...Array.from(visitedSiteIds))
        break
      } else {
        visitedSiteIds.add(leaderId)
        leaderId = nextTether.leaderId
        nextTether = this.tethersByFollowerId.get(leaderId)
      }
    }

    return leaderId
  }

  cursorPositionForSiteId (siteId) {
    let selections

    if (siteId === this.siteId) {
      selections = this.getLocalHiddenSelections()
    } else if (this.selectionLayerIdsBySiteId.has(siteId)) {
      const layerId = this.selectionLayerIdsBySiteId.get(siteId)
      selections = this.bufferProxy.getMarkers()[siteId][layerId]
    } else {
      selections = {}
    }

    const selectionIds = Object.keys(selections).map((key) => parseInt(key))
    if (selectionIds.length > 0) {
      const lastSelection = selections[Math.max(...selectionIds)]
      return lastSelection.reversed ? lastSelection.range.start : lastSelection.range.end
    }
  }

  getLocalHiddenSelections () {
    const localLayers = this.bufferProxy.getMarkers()[this.siteId]
    return localLayers ? localLayers[this.localHiddenSelectionsLayerId] : {}
  }

  hostDidDisconnect () {
    this.selectionLayerIdsBySiteId.forEach((_, siteId) => {
      this.siteDidDisconnect(siteId)
    })
  }

  siteDidDisconnect (siteId) {
    const tether = this.tethersByFollowerId.get(this.siteId)
    if (tether && siteId === tether.leaderId) {
      this.unfollow()
    }

    this.selectionLayerIdsBySiteId.delete(siteId)
    this.tethersByFollowerId.delete(siteId)

    this.delegate.clearSelectionsForSiteId(siteId)
    this.updateActivePositions()
  }

  receiveFetch ({requestId}) {
    this.router.respond(requestId, {body: this.serialize().serializeBinary()})
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
    const oldResolvedLeaderId = this.resolveLeaderSiteId()
    const oldResolvedState = this.resolveFollowState()
    const wasRetracted = oldResolvedState === FollowState.RETRACTED

    const followerSiteId = tetherUpdate.getFollowerSiteId()
    const leaderSiteId = tetherUpdate.getLeaderSiteId()
    const tetherState = tetherUpdate.getState()
    this.tethersByFollowerId.set(followerSiteId, {leaderId: leaderSiteId, state: tetherState})

    const newResolvedLeaderId = this.resolveLeaderSiteId()
    const newResolvedState = this.resolveFollowState()
    const isRetracted = newResolvedState === FollowState.RETRACTED

    if (wasRetracted !== isRetracted) {
      this.updateSelections(this.getLocalHiddenSelections(), true)
    }

    if (newResolvedLeaderId !== oldResolvedLeaderId) {
      this.delegate.updateTether(newResolvedState, this.resolveLeaderPosition())
    }

    this.updateActivePositions()
  }
}

function pointsEqual (a, b) {
  return a.row === b.row && a.column === b.column
}
