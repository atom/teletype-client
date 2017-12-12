const {CompositeDisposable, Emitter} = require('event-kit')
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

    return new EditorProxy(Object.assign({id, bufferProxy, selectionLayerIdsBySiteId}, props))
  }

  constructor ({id, bufferProxy, selectionLayerIdsBySiteId, selections, router, siteId, didDispose, portal}) {
    this.id = id
    this.siteId = siteId
    this.isHost = (this.siteId === 1)
    this.bufferProxy = bufferProxy
    this.router = router
    this.emitDidDispose = didDispose || doNothing
    this.selectionLayerIdsBySiteId = selectionLayerIdsBySiteId || new Map()
    this.localHiddenSelectionsLayerId = bufferProxy.getNextMarkerLayerId()
    this.delegate = new NullEditorProxyDelegate()
    this.emitter = new Emitter()
    this.selectionsVisible = true
    this.portal = portal
    this.createLocalSelectionsLayer(selections)

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
    this.delegate.dispose()
    if (this.isHost) this.router.notify({channelId: `/editors/${this.id}/disposal`})
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
    this.delegate = delegate || new NullEditorProxyDelegate()
    this.bufferProxyDidUpdateMarkers(this.bufferProxy.getMarkers(), {initialUpdate: true})
  }

  createLocalSelectionsLayer (selections) {
    const localSelectionsLayerId = this.bufferProxy.getNextMarkerLayerId()
    this.selectionLayerIdsBySiteId.set(this.siteId, localSelectionsLayerId)

    const selectionsUpdateMessage = new Messages.EditorProxyUpdate.SelectionsUpdate()
    selectionsUpdateMessage.getSelectionLayerIdsBySiteIdMap().set(this.siteId, localSelectionsLayerId)
    const editorProxyUpdateMessage = new Messages.EditorProxyUpdate()
    editorProxyUpdateMessage.setSelectionsUpdate(selectionsUpdateMessage)

    this.router.notify({channelId: `/editors/${this.id}/updates`, body: editorProxyUpdateMessage.serializeBinary()})

    if (selections) this.updateSelections(selections, {initialUpdate: true})
  }

  updateSelections (selections = {}, options = {}) {
    this.bufferProxy.updateMarkers({
      [this.localHiddenSelectionsLayerId]: selections
    }, false)

    if (this.selectionsVisible) {
      const localSelectionsLayerId = this.selectionLayerIdsBySiteId.get(this.siteId)
      this.bufferProxy.updateMarkers({
        [localSelectionsLayerId]: selections
      })
    }

    this.emitter.emit('did-update-local-selections', options)
  }

  bufferProxyDidUpdateMarkers (markerUpdates, options = {}) {
    const selectionLayerIdsBySiteId = new Map()

    for (let siteId in markerUpdates) {
      siteId = parseInt(siteId)
      if (siteId !== this.siteId) {
        const layersById = markerUpdates[siteId]
        for (let layerId in layersById) {
          layerId = parseInt(layerId)
          if (this.selectionLayerIdsBySiteId.get(siteId) === layerId) {
            const selections = layersById[layerId]
            this.delegate.updateSelectionsForSiteId(siteId, selections)
            selectionLayerIdsBySiteId.set(siteId, layerId)
          }
        }
      }
    }

    this.emitter.emit('did-update-remote-selections', {selectionLayerIdsBySiteId, initialUpdate: options.initialUpdate})
  }

  didScroll (callback) {
    this.emitter.emit('did-scroll')
  }

  onDidScroll (callback) {
    return this.emitter.on('did-scroll', callback)
  }

  onDidUpdateLocalSelections (callback) {
    return this.emitter.on('did-update-local-selections', callback)
  }

  onDidUpdateRemoteSelections (callback) {
    return this.emitter.on('did-update-remote-selections', callback)
  }

  cursorPositionForSiteId (siteId) {
    let selections

    if (siteId === this.siteId) {
      selections = this.getLocalHiddenSelections()
    } else if (this.selectionLayerIdsBySiteId.has(siteId)) {
      const layers = this.bufferProxy.getMarkers()[siteId]
      const selectionLayerId = this.selectionLayerIdsBySiteId.get(siteId)
      selections = layers ? layers[selectionLayerId] : {}
    } else {
      selections = {}
    }

    const selectionIds = Object.keys(selections).map((key) => parseInt(key))
    if (selectionIds.length > 0) {
      const lastSelection = selections[Math.max(...selectionIds)]
      return lastSelection.reversed ? lastSelection.range.start : lastSelection.range.end
    }
  }

  isScrollNeededToViewPosition (position) {
    return this.delegate.isScrollNeededToViewPosition(position)
  }

  hideSelections () {
    const localSelectionsLayerId = this.selectionLayerIdsBySiteId.get(this.siteId)
    if (this.selectionsVisible && localSelectionsLayerId) {
      const selectionsUpdate = {}
      for (const selectionId in this.getLocalHiddenSelections()) {
        selectionsUpdate[selectionId] = null
      }

      this.bufferProxy.updateMarkers({
        [localSelectionsLayerId]: selectionsUpdate
      })
    }

    this.selectionsVisible = false
  }

  showSelections () {
    const localSelectionsLayerId = this.selectionLayerIdsBySiteId.get(this.siteId)
    if (!this.selectionsVisible && localSelectionsLayerId) {
      this.bufferProxy.updateMarkers({
        [localSelectionsLayerId]: this.getLocalHiddenSelections()
      })
    }

    this.selectionsVisible = true
  }

  getLocalHiddenSelections () {
    const localLayers = this.bufferProxy.getMarkers()[this.siteId]
    const localHiddenSelectionsLayer = localLayers ? localLayers[this.localHiddenSelectionsLayerId] : null
    return localHiddenSelectionsLayer || {}
  }

  hostDidDisconnect () {
    this.selectionLayerIdsBySiteId.forEach((_, siteId) => {
      this.siteDidDisconnect(siteId)
    })
  }

  siteDidDisconnect (siteId) {
    this.selectionLayerIdsBySiteId.delete(siteId)
    this.delegate.clearSelectionsForSiteId(siteId)
  }

  receiveFetch ({requestId}) {
    this.router.respond({requestId, body: this.serialize().serializeBinary()})
  }

  receiveUpdate ({body}) {
    const updateMessage = Messages.EditorProxyUpdate.deserializeBinary(body)

    if (updateMessage.hasSelectionsUpdate()) {
      this.receiveSelectionsUpdate(updateMessage.getSelectionsUpdate())
    }
  }

  receiveSelectionsUpdate (selectionsUpdate) {
    selectionsUpdate.getSelectionLayerIdsBySiteIdMap().forEach((layerId, siteId) => {
      this.selectionLayerIdsBySiteId.set(siteId, layerId)
    })
  }
}
