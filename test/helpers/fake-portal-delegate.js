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

  setActiveSharedEditor (sharedEditor) {
    this.sharedEditor = sharedEditor
  }

  getActiveSharedEditor () {
    return this.sharedEditor
  }

  getActiveBufferURI () {
    return (this.sharedEditor) ? this.sharedEditor.sharedBuffer.uri : null
  }
}
