const assert = require('assert')

module.exports =
class FakePortalDelegate {
  constructor () {
    this.hostClosedPortal = false
    this.hostLostConnection = false
    this.joinEvents = []
    this.leaveEvents = []
    this.tetherEditorProxyChangeCount = 0
    this.tetherPosition = null
    this.activePositionsBySiteId = {}
    this.editorProxiesChangeEventCount = 0
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

  getTetherEditorProxy () {
    return this.tetherEditorProxy
  }

  getTetherBufferProxyURI () {
    return (this.tetherEditorProxy) ? this.tetherEditorProxy.bufferProxy.uri : null
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
      const {editorProxy, position, followState} = this.activePositionsBySiteId[siteId]
      const editorProxyId = editorProxy ? editorProxy.id : null
      return {siteId, editorProxyId, position, followState}
    })
  }

  siteDidJoin (siteId) {
    this.joinEvents.push(siteId)
  }

  siteDidLeave (siteId) {
    this.leaveEvents.push(siteId)
  }

  didChangeEditorProxies () {
    this.editorProxiesChangeEventCount++
  }
}
