const assert = require('assert')

module.exports =
class Editor {
  constructor () {
    this.selectionMarkerLayersBySiteId = new Map()
  }

  setSelectionMarkerLayerForSiteId (siteId, selectionMarkerLayer) {
    assert.equal(typeof siteId, 'number', 'siteId must be a number!')
    this.selectionMarkerLayersBySiteId.set(siteId, selectionMarkerLayer)
  }

  markerLayerForSiteId (siteId) {
    assert.equal(typeof siteId, 'number', 'siteId must be a number!')
    return this.selectionMarkerLayersBySiteId.get(siteId)
  }
}
