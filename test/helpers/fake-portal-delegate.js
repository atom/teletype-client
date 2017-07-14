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

  setActiveTextEditor (editor) {
    this.editor = editor
  }

  getActiveTextEditor () {
    return this.editor
  }

  getActiveTextBufferURI () {
    return (this.editor) ? this.editor.buffer.uri : null
  }
}
