module.exports =
class Workspace {
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
