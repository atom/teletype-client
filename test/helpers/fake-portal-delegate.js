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

  setActiveTextEditor (textEditor) {
    this.textEditor = textEditor
  }

  getActiveTextEditor () {
    return this.textEditor
  }

  getActiveTextBufferURI () {
    return (this.textEditor) ? this.textEditor.textBuffer.uri : null
  }
}
