const assert = require('assert')

module.exports =
class FakePortalDelegate {
  constructor () {
    this.hostClosedPortal = false
    this.hostLostConnection = false
    this.joinEvents = []
    this.leaveEvents = []
    this.editorProxies = new Set()
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

  addEditorProxy (editorProxy) {
    assert(!this.editorProxies.has(editorProxy), 'Cannot add the same editor proxy multiple times')
    this.editorProxies.add(editorProxy)
  }

  removeEditorProxy (editorProxy) {
    assert(this.editorProxies.has(editorProxy), 'Can only remove editor proxies that had previously been added')
    this.editorProxies.delete(editorProxy)
    if (this.tetherEditorProxy == editorProxy) {
      this.tetherEditorProxy = null
      this.tetherEditorProxyChangeCount++
    }
  }

  editorProxyForURI (uri) {
    return Array.from(this.editorProxies).find((e) => e.bufferProxy.uri === uri)
  }

  getTetherEditorProxy () {
    return this.tetherEditorProxy
  }

  getTetherBufferProxyURI () {
    return (this.tetherEditorProxy) ? this.tetherEditorProxy.bufferProxy.uri : null
  }

  getEditorProxies () {
    return Array.from(this.editorProxies)
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
