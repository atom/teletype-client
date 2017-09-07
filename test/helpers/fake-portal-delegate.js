module.exports =
class FakePortalDelegate {
  constructor () {
    this.hostClosedPortal = false
    this.hostLostConnection = false
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

  setActiveEditorProxy (editorProxy) {
    this.editorProxy = editorProxy
  }

  getActiveEditorProxy () {
    return this.editorProxy
  }

  addScreenShareTrack (track) {
    this.lastScreenShareTrack = track
  }

  getLastScreenShareTrack () {
    return this.lastScreenShareTrack
  }

  getActiveBufferProxyURI () {
    return (this.editorProxy) ? this.editorProxy.bufferProxy.uri : null
  }
}
