const SharedEditor = require('./shared-editor')

module.exports =
class GuestPortal {
  constructor ({id, restGateway, pubSubGateway}) {
    this.id = id
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
  }

  setDelegate (delegate) {
    this.delegate = delegate
    if (this.activeSharedEditor) this.delegate.setActiveSharedEditor(this.activeSharedEditor)
  }

  async join () {
    const {activeSharedEditorId} = await this.restGateway.get(`/portals/${this.id}`)
    await this.subscribe()
    if (activeSharedEditorId) {
      this.activeSharedEditor = await this.joinSharedEditor(activeSharedEditorId)
    }
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

  async subscribe () {
    this.subscription = await this.pubSubGateway.subscribe(
      `/portals/${this.id}`,
      'update',
      this.receiveUpdate.bind(this)
    )
  }

  async receiveUpdate (message) {
    const {activeSharedEditorId} = JSON.parse(message.text)
    if (activeSharedEditorId) {
      this.activeSharedEditor = await this.joinSharedEditor(activeSharedEditorId)
    } else {
      this.activeSharedEditor = null
    }
    if (this.delegate) this.delegate.setActiveSharedEditor(this.activeSharedEditor)
  }
}
