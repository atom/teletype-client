module.exports =
class FakePortalDelegate {
  constructor () {
    this.hostClosedPortal = false
    this.hostDisconnected = false
  }

  hostDidClosePortal () {
    this.hostClosedPortal = true
  }

  isClosed () {
    return this.hostClosedPortal
  }

  hostDidDisconnect () {
    this.hostDisconnected = true
  }

  hasHostDisconnected () {
    return this.hostDisconnected
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
