const assert = require('assert')

module.exports =
class FakePortalDelegate {
  constructor () {
    this.hostClosedPortal = false
    this.hostLostConnection = false
    this.joinEvents = []
    this.leaveEvents = []
    this.editorProxies = new Set()
    this.activeEditorProxyChangeCount = 0
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
    if (this.activeEditorProxy === editorProxy) {
      this.activeEditorProxy = null
      this.activeEditorProxyChangeCount++
    }
  }

  async activateEditorProxy (editorProxy) {
    this.activeEditorProxy = editorProxy
    this.activeEditorProxyChangeCount++
  }

  editorProxyForURI (uri) {
    return Array.from(this.editorProxies).find((e) => e.bufferProxy.uri === uri)
  }

  getActiveEditorProxy () {
    return this.activeEditorProxy
  }

  getActiveBufferProxyURI () {
    return (this.activeEditorProxy) ? this.activeEditorProxy.bufferProxy.uri : null
  }

  getEditorProxies () {
    return Array.from(this.editorProxies)
  }

  updateTether (state, position) {
    this.tetherState = state
    this.tetherPosition = position
  }

  getTetherState () {
    return this.tetherState
  }

  getTetherPosition () {
    return this.tetherPosition
  }

  activePositionForSiteId (siteId) {
    return this.activePositionsBySiteId[siteId]
  }

  updateActivePositions (activePositionsBySiteId) {
    this.activePositionsBySiteId = activePositionsBySiteId
  }

  siteDidJoin (siteId) {
    this.joinEvents.push(siteId)
  }

  siteDidLeave (siteId) {
    this.leaveEvents.push(siteId)
  }
}
