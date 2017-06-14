const SharedEditor = require('./shared-editor')

module.exports =
class GuestPortal {
  constructor ({id, restGateway, pubSubGateway}) {
    this.id = id
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
  }

  async join () {
    const {activeSharedEditorId} = await this.restGateway.get(`/portals/${this.id}`)
    if (activeSharedEditorId) {
      this.activeSharedEditor = await this.joinSharedEditor(activeSharedEditorId)
    }
  }

  getActiveSharedEditor () {
    return this.activeSharedEditor
  }

  async joinSharedEditor (sharedEditorId) {
    const sharedEditor = new SharedEditor({
      id: sharedEditorId,
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway
    })
    await sharedEditor.join()
    return sharedEditor
  }
}
