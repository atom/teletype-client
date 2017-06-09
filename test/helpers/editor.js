module.exports =
class Editor {
  constructor () {
    this.selectionMarkerLayersBySiteId = {}
  }

  setSelectionMarkerLayerForSiteId (siteId, selectionMarkerLayer) {
    this.selectionMarkerLayersBySiteId[siteId] = selectionMarkerLayer
  }
}
