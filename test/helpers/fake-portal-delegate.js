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

  async activateEditorProxy (editorProxy) {
    this.editorProxies.add(editorProxy)
    this.activeEditorProxy = editorProxy
    this.activeEditorProxyChangeCount++
  }

  removeEditorProxy (editorProxy) {
    this.editorProxies.delete(editorProxy)
    if (this.activeEditorProxy === editorProxy) {
      this.activeEditorProxy = null
      this.activeEditorProxyChangeCount++
    }
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

  siteDidJoin (siteId) {
    this.joinEvents.push(siteId)
  }

  siteDidLeave (siteId) {
    this.leaveEvents.push(siteId)
  }
}
