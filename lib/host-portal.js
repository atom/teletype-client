const SharedBuffer = require('./shared-buffer')
const SharedEditor = require('./shared-editor')
const HOST_SITE_ID = 1

module.exports =
class HostPortal {
  constructor ({restGateway, pubSubGateway}) {
    this.id = null
    this.restGateway = restGateway
    this.pubSubGateway = pubSubGateway
  }

  async create () {
    const {id} = await this.restGateway.post('/portals')
    this.id = id
  }

  async createSharedEditor ({sharedBuffer, selectionRanges}) {
    const sharedEditor = new SharedEditor({
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway,
      siteId: HOST_SITE_ID
    })
    await sharedEditor.create({sharedBuffer, selectionRanges})
    return sharedEditor
  }

  async createSharedBuffer ({uri, text}) {
    const sharedBuffer = new SharedBuffer({
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway,
      siteId: HOST_SITE_ID
    })
    await sharedBuffer.create({uri, text})
    return sharedBuffer
  }

  async setActiveSharedEditor (sharedEditor) {
    const sharedEditorId = sharedEditor ? sharedEditor.id : null
    await this.restGateway.put(`/portals/${this.id}`, {sharedEditorId})
  }
}
