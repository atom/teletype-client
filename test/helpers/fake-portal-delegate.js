module.exports =
class FakePortalDelegate {
  constructor () {
    this.hostClosedPortal = false
    this.hostLostConnection = false
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

  setActiveEditorProxy (editorProxy) {
    this.editorProxy = editorProxy
  }

  getActiveEditorProxy () {
    return this.editorProxy
  }

  getActiveBufferProxyURI () {
    return (this.editorProxy) ? this.editorProxy.bufferProxy.uri : null
  }
}
