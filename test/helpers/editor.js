const assert = require('assert')

module.exports =
class Editor {
  constructor (buffer) {
    this.buffer = buffer
    this.selectionLayerIdsBySiteId = new Map()
  }

  setSelectionLayerIdForSiteId (siteId, layerId) {
    assert.equal(typeof siteId, 'number', 'siteId must be a number!')
    if (layerId != null) assert.equal(typeof layerId, 'number', 'layerId must be a number!')
    this.selectionLayerIdsBySiteId.set(siteId, layerId)
  }

  getSelections (siteId) {
    assert.equal(typeof siteId, 'number', 'siteId must be a number!')
    const layerId = this.selectionLayerIdsBySiteId.get(siteId)
    return this.buffer.getMarkers(siteId, layerId)
  }
}
