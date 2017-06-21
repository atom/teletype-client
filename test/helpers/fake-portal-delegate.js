module.exports =
class FakePortalDelegate {
  constructor () {
    this.hostDisconnected = false
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
    return this.getActiveSharedEditor().sharedBuffer.uri
  }
}
