const assert = require('assert')

module.exports =
class FakePortalDelegate {
  constructor () {
    this.hostClosedPortal = false
    this.hostLostConnection = false
    this.joinEvents = []
    this.leaveEvents = []
    this.editorProxiesMetadataById = new Map()
    this.tetherEditorProxyChangeCount = 0
    this.tetherPosition = null
    this.activePositionsBySiteId = {}
  }

  dispose () {
    this.disposed = true
  }

  isDisposed () {
    return this.disposed
  }

  hostDidClosePortal () {
    this.hostClosedPortal = true
  }

  hasHostClosedPortal () {
    return this.hostClosedPortal
  }

  hostDidLoseConnection () {
    this.hostLostConnection = true
  }

  hasHostLostConnection () {
    return this.hostLostConnection
  }

  addEditorProxy (editorProxyMetadata) {
    assert(!this.editorProxiesMetadataById.has(editorProxyMetadata.id), 'Cannot add the same editor proxy multiple times')

    this.editorProxiesMetadataById.set(editorProxyMetadata.id, editorProxyMetadata)
  }

  removeEditorProxy (editorProxyMetadata) {
    assert(this.editorProxiesMetadataById.has(editorProxyMetadata.id), 'Can only remove editor proxies that had previously been added')

    this.editorProxiesMetadataById.delete(editorProxyMetadata.id)
    if (this.tetherEditorProxy && this.tetherEditorProxy.id == editorProxyMetadata.id) {
      this.tetherEditorProxy = null
      this.tetherEditorProxyChangeCount++
    }
  }

  editorProxyMetadataForURI (uri) {
    return Array.from(this.editorProxiesMetadataById.values()).find((e) => e.bufferProxyURI === uri)
  }

  getTetherEditorProxy () {
    return this.tetherEditorProxy
  }

  getTetherBufferProxyURI () {
    return (this.tetherEditorProxy) ? this.tetherEditorProxy.bufferProxy.uri : null
  }

  getEditorProxiesCount () {
    return this.editorProxiesMetadataById.size
  }

  updateTether (state, editorProxy, position) {
    this.tetherState = state
    if (editorProxy != this.tetherEditorProxy) {
      this.tetherEditorProxy = editorProxy
      this.tetherEditorProxyChangeCount++
    }
    this.tetherPosition = position
  }

  getTetherState () {
    return this.tetherState
  }

  getTetherPosition () {
    return this.tetherPosition
  }

  updateActivePositions (activePositionsBySiteId) {
    this.activePositionsBySiteId = activePositionsBySiteId
  }

  getActivePositions () {
    return Object.keys(this.activePositionsBySiteId).map((siteId) => {
      const {editorProxy, position} = this.activePositionsBySiteId[siteId]
      return {siteId, editorProxyId: editorProxy.id, position}
    })
  }

  siteDidJoin (siteId) {
    this.joinEvents.push(siteId)
  }

  siteDidLeave (siteId) {
    this.leaveEvents.push(siteId)
  }
}
