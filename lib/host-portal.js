const SharedBuffer = require('./shared-buffer')
const SharedEditor = require('./shared-editor')

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
      pubSubGateway: this.pubSubGateway
    })
    await sharedEditor.create({sharedBuffer, selectionRanges})
    return sharedEditor
  }

  async createSharedBuffer ({uri, text}) {
    const sharedBuffer = new SharedBuffer({
      restGateway: this.restGateway,
      pubSubGateway: this.pubSubGateway
    })
    await sharedBuffer.create({uri, text})
    return sharedBuffer
  }

  async setActiveSharedEditor (sharedEditor) {
    await this.restGateway.put(`/portals/${this.id}`, {sharedEditorId: sharedEditor.id})
  }
}
