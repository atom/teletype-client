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

  setActiveTextEditor (textEditor) {
    this.textEditor = textEditor
  }

  getActiveTextEditor () {
    return this.textEditor
  }

  addScreenShareTrack (track) {
    this.lastScreenShareTrack = track
  }

  getLastScreenShareTrack () {
    return this.lastScreenShareTrack
  }

  getActiveTextBufferURI () {
    return (this.textEditor) ? this.textEditor.textBuffer.uri : null
  }
}
